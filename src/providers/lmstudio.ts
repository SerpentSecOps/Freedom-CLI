/**
 * LM Studio provider implementation
 * Supports local models via OpenAI-compatible API
 */

import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.js';
import type { ToolDefinition } from '../types.js';
import { LLMProvider, type ProviderConfig, type CompletionResult, type StreamOptions } from './base.js';
import { getConfig } from '../config.js';

// OpenAI-compatible content types for vision support
type LMStudioContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };

interface LMStudioMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | LMStudioContentPart[];
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

interface LMStudioTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

interface LMStudioStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
}

// Patterns for extracting tool calls from text output
// Some models output tool calls as JSON in text instead of using the proper tool_calls field
const TOOL_CALL_PATTERNS = [
  // Pattern: {"name": "tool_name", "arguments": {...}}
  /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})\s*\}/g,
  // Pattern: {"name": "tool_name", "parameters": {...}}
  /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"parameters"\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})\s*\}/g,
  // Pattern: <tool_call>{"name": "...", "arguments": {...}}</tool_call>
  /<tool_call>\s*\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})\s*\}\s*<\/tool_call>/g,
  // Pattern: ```json\n{"name": "...", "arguments": {...}}\n```
  /```json\s*\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})\s*\}\s*```/g,
];

export class LMStudioProvider extends LLMProvider {
  private baseURL: string;
  private availableTools: Set<string> = new Set();

  constructor(config: ProviderConfig & { baseURL?: string }) {
    super(config);
    // Default to LM Studio's default address (uses 127.0.0.1 by default)
    this.baseURL = config.baseURL || 'http://127.0.0.1:1234/v1';
  }

  async streamCompletion(
    messages: MessageParam[],
    tools: ToolDefinition[],
    options?: StreamOptions
  ): Promise<CompletionResult> {
    const lmMessages = this.convertMessages(messages);
    const lmTools = this.convertTools(tools);

    // Track available tool names for fallback text parsing
    this.availableTools = new Set(tools.map(t => t.name));

    // Create abort controller for this request
    const abortController = this.createAbortController();

    // Get config for timeout settings
    const cliConfig = getConfig();

    const requestBody: any = {
      model: this.config.model,
      messages: lmMessages,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      stream: true,
    };

    // Add tools if provided
    if (lmTools.length > 0) {
      requestBody.tools = lmTools;
      requestBody.tool_choice = 'auto';
    }

    let response: Response | undefined;
    let retries = cliConfig.lmstudioRetries || 3;
    let retryDelay = cliConfig.lmstudioRetryDelay || 2000;

    while (retries > 0) {
      try {
        // Add connection timeout to fetch (default fetch timeout is too short for LM Studio)
        const fetchTimeout = Math.min(cliConfig.apiTimeout || 600000, 900000); // Cap at 15min
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), fetchTimeout);

        response = await fetch(`${this.baseURL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache',
            // LM Studio doesn't require auth by default, but include if provided
            ...(this.config.apiKey && this.config.apiKey !== 'not-needed' && { 'Authorization': `Bearer ${this.config.apiKey}` }),
          },
          body: JSON.stringify({
            ...requestBody,
            // Optimize for continuous operations
            keep_alive: true,
            stream_options: {
              include_usage: false, // Reduce overhead
            },
          }),
          signal: controller.signal,
          keepalive: true, // Keep connection alive for better performance
        });

        clearTimeout(timeoutId);
        break; // Success, exit retry loop

      } catch (error: any) {
        retries--;
        
        // Check if this was an abort
        if (error.name === 'AbortError' && abortController.signal.aborted) {
          throw new Error('Request aborted by user');
        }
        
        // Connection errors - retry with exponential backoff
        if (error.cause?.code === 'ECONNREFUSED' || 
            error.name === 'AbortError' ||
            error.message.includes('fetch failed') ||
            error.message.includes('timeout') ||
            error.code === 'ENOTFOUND' ||
            error.code === 'ECONNRESET' ||
            error.message.includes('network')) {
          
          if (retries > 0) {
            console.log(`🔄 LM Studio connection failed, retrying in ${retryDelay}ms... (${retries} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            retryDelay *= 1.5; // Exponential backoff
            continue;
          }
          
          // All retries exhausted
          throw new Error(`❌ Cannot connect to LM Studio at ${this.baseURL}\n\nTried ${cliConfig.lmstudioRetries || 3} times. Make sure:\n1. LM Studio is running\n2. Server is started (⚡ icon in LM Studio)\n3. A model is loaded\n4. Server URL is correct: ${this.baseURL}\n5. Model supports function calling\n\n💡 Try increasing timeout with: /timeout ~\n💡 For continuous loops, try shorter iterations: /cl "prompt" -5`);
        }
        
        // Other errors - don't retry
        throw new Error(`Network error connecting to LM Studio: ${error.message}`);
      }
    }

    if (!response) {
      throw new Error('Failed to get response from LM Studio after retries');
    }

    if (!response.ok) {
      const errorText = await response.text();

      // Check for tool support error
      if (errorText.includes('Only user and assistant roles are supported') ||
          errorText.includes('tool') && errorText.includes('not supported')) {
        throw new Error(`❌ This model does not support tool/function calling.

The model "${this.config.model}" cannot handle tools, which Freedom CLI requires.

To fix this, load a different model in LM Studio that supports function calling:
  • Qwen 2.5 (recommended - good tool support)
  • Llama 3.1 or 3.2
  • Mistral (some versions)
  • Any model with "function calling" in its description

Look for models from "lmstudio-community" - they typically have proper prompt templates.`);
      }

      throw new Error(`LM Studio API error: ${response.status} - ${errorText}`);
    }

    return this.processStream(response, options, abortController.signal);
  }

  private async processStream(
    response: Response,
    options?: StreamOptions,
    abortSignal?: AbortSignal
  ): Promise<CompletionResult> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    // Get config for timeout handling
    const cliConfig = getConfig();
    const decoder = new TextDecoder();
    const content: CompletionResult['content'] = [];
    let rawBuffer = '';           // All raw text received
    let thinkingBuffer = '';      // Extracted thinking content
    let stopReason: string | null = null;
    let thinkingIndicatorShown = false;

    // Track tool calls being built across chunks
    const toolCallsMap = new Map<number, {
      id?: string;
      name?: string;
      arguments: string;
    }>();

    // Activity-based timeout: reset timer on each chunk received  
    const inactivityTimeout = (cliConfig.apiTimeout !== undefined ? cliConfig.apiTimeout : 600000); // Default 10min for LM Studio
    let activityTimer: NodeJS.Timeout | null = null;
    let timedOut = false;

    const resetActivityTimer = () => {
      if (activityTimer) {
        clearTimeout(activityTimer);
      }
      // Only set timer if not unlimited
      if (inactivityTimeout !== Infinity && inactivityTimeout > 0) {
        activityTimer = setTimeout(() => {
          timedOut = true;
          reader.cancel('Inactivity timeout');
        }, inactivityTimeout);
      }
    };

    // Start initial timer
    resetActivityTimer();

    try {
      while (true) {
        // Check if aborted or timed out
        if (abortSignal?.aborted || timedOut) {
          break;
        }

        const { done, value } = await reader.read();

        // Reset timer on any data received
        resetActivityTimer();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim() !== '');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              break;
            }

            try {
              const parsed = JSON.parse(data);

              // Skip events without choices (e.g., metadata events)
              if (!parsed.choices || !Array.isArray(parsed.choices) || parsed.choices.length === 0) {
                continue;
              }

              const choice = parsed.choices[0];
              if (!choice || !choice.delta) continue;

              // Collect all text - we'll process thinking tags after streaming completes
              // Show a thinking indicator while collecting
              if (choice.delta.content) {
                // Show thinking indicator on first content
                if (!thinkingIndicatorShown) {
                  options?.onTextDelta?.('💭 Thinking...\n');
                  thinkingIndicatorShown = true;
                }
                rawBuffer += choice.delta.content;
              }

              // Handle tool calls
              if (choice.delta.tool_calls && Array.isArray(choice.delta.tool_calls)) {
                for (const toolCall of choice.delta.tool_calls) {
                  const existing = toolCallsMap.get(toolCall.index) || {
                    id: undefined,
                    name: undefined,
                    arguments: '',
                  };

                  if (toolCall.id) existing.id = toolCall.id;
                  if (toolCall.function?.name) existing.name = toolCall.function.name;
                  if (toolCall.function?.arguments) {
                    existing.arguments += toolCall.function.arguments;
                  }

                  toolCallsMap.set(toolCall.index, existing);
                }
              }

              // Handle finish reason
              if (choice.finish_reason) {
                stopReason = choice.finish_reason;
              }
            } catch (e) {
              // Check for tool support error in stream
              if (data.includes('Only user and assistant roles are supported') ||
                  (data.includes('tool') && data.includes('not supported'))) {
                throw new Error(`❌ This model does not support tool/function calling.

The currently loaded model cannot handle tools, which Freedom CLI requires.

To fix this, load a different model in LM Studio that supports function calling:
  • Qwen 2.5 (recommended - good tool support)
  • Llama 3.1 or 3.2
  • Mistral (some versions)
  • Any model with "function calling" in its description

Look for models from "lmstudio-community" - they typically have proper prompt templates.`);
              }
              // Only log if it looks like an actual error, not a keepalive
              if (data.includes('error') || data.includes('Error')) {
                console.error('LM Studio error:', data);
              }
            }
          }
        }
      }
    } catch (error: any) {
      // Check if this was our inactivity timeout
      if (timedOut) {
        const timeoutError = new Error(`Operation timed out after ${inactivityTimeout}ms of inactivity`);
        timeoutError.name = 'TimeoutError';
        throw timeoutError;
      }
      throw error;
    } finally {
      // Clean up timer
      if (activityTimer) {
        clearTimeout(activityTimer);
      }
      reader.releaseLock();
    }

    // Check if we timed out during the loop
    if (timedOut) {
      const timeoutError = new Error(`Operation timed out after ${inactivityTimeout}ms of inactivity`);
      timeoutError.name = 'TimeoutError';
      throw timeoutError;
    }

    // Process the complete response to extract thinking and clean text
    // Extract thinking content from <think>...</think> or content before </think>
    let textBuffer = '';
    let idx = 0;
    let inThink = false;

    while (idx < rawBuffer.length) {
      if (inThink) {
        const closeIdx = rawBuffer.indexOf('</think>', idx);
        if (closeIdx !== -1) {
          thinkingBuffer += rawBuffer.slice(idx, closeIdx);
          idx = closeIdx + 8;
          inThink = false;
        } else {
          // Unclosed thinking block - rest is thinking
          thinkingBuffer += rawBuffer.slice(idx);
          break;
        }
      } else {
        const openIdx = rawBuffer.indexOf('<think>', idx);
        const closeIdx = rawBuffer.indexOf('</think>', idx);

        // Handle </think> without <think> - everything before it is thinking
        if (closeIdx !== -1 && (openIdx === -1 || closeIdx < openIdx)) {
          thinkingBuffer += rawBuffer.slice(idx, closeIdx);
          idx = closeIdx + 8;
          continue;
        }

        if (openIdx !== -1) {
          // Content before <think> is regular text
          textBuffer += rawBuffer.slice(idx, openIdx);
          idx = openIdx + 7;
          inThink = true;
        } else {
          // No more think tags - rest is regular text
          textBuffer += rawBuffer.slice(idx);
          break;
        }
      }
    }

    textBuffer = textBuffer.trim();
    thinkingBuffer = thinkingBuffer.trim();

    // Clear the "Thinking..." indicator
    if (thinkingIndicatorShown) {
      options?.onTextDelta?.('\r\x1b[K'); // Clear current line
    }

    // Don't stream text here - let the agent handle display order
    // (reasoning first, then response)
    // The text will be returned in content and the agent will display it

    // Add tool calls from proper tool_calls field
    for (const [_, toolCall] of toolCallsMap) {
      if (toolCall.id && toolCall.name) {
        try {
          // Try to parse the arguments, with fallback for incomplete JSON
          let input: Record<string, unknown>;
          try {
            input = JSON.parse(toolCall.arguments);
          } catch (parseError) {
            // Try to repair incomplete JSON by adding missing closing braces/brackets
            const repaired = this.tryRepairJson(toolCall.arguments);
            if (repaired) {
              input = repaired;
            } else {
              // If repair fails and we have a tool name, try with empty args
              console.warn(`Tool '${toolCall.name}' has invalid/incomplete arguments, using empty object`);
              input = {};
            }
          }

          const toolUse = {
            type: 'tool_use' as const,
            id: toolCall.id,
            name: toolCall.name,
            input,
          };
          content.push(toolUse);
          options?.onToolUse?.(toolUse);
        } catch (e) {
          console.error('Failed to process tool call:', e);
        }
      }
    }

    // If no tool calls found via proper field, try to extract from text
    // This handles models that output tool calls as JSON in text content
    if (toolCallsMap.size === 0 && textBuffer) {
      const extractedTools = this.extractToolCallsFromText(textBuffer);

      if (extractedTools.length > 0) {
        // Clean the text buffer - remove the tool call JSON from displayed text
        let cleanedText = textBuffer;
        for (const extracted of extractedTools) {
          cleanedText = cleanedText.replace(extracted.originalMatch, '').trim();
        }

        // Add cleaned text if any remains (and it's not just garbage)
        const meaningfulText = cleanedText
          .replace(/[^\x20-\x7E\n\r\t]/g, '') // Remove non-printable chars
          .replace(/\s+/g, ' ')
          .trim();

        if (meaningfulText && meaningfulText.length > 10) {
          content.push({
            type: 'text',
            text: meaningfulText,
          });
        }

        // Add extracted tool calls
        for (const extracted of extractedTools) {
          const toolUse = {
            type: 'tool_use' as const,
            id: extracted.id,
            name: extracted.name,
            input: extracted.input,
          };
          content.push(toolUse);
          options?.onToolUse?.(toolUse);
        }
      } else {
        // No tool calls extracted, add text as-is
        if (textBuffer) {
          content.push({
            type: 'text',
            text: textBuffer,
          });
        }
      }
    } else if (textBuffer && toolCallsMap.size > 0) {
      // Have both proper tool calls and text - add text content
      content.push({
        type: 'text',
        text: textBuffer,
      });
    } else if (textBuffer) {
      // Only text, no tool calls
      content.push({
        type: 'text',
        text: textBuffer,
      });
    }

    return {
      content,
      stopReason,
      reasoning: thinkingBuffer || undefined, // Store thinking as reasoning (same as DeepSeek)
    };
  }

  /**
   * Extract tool calls from text content for models that don't use proper tool_calls field
   */
  private extractToolCallsFromText(text: string): Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
    originalMatch: string;
  }> {
    const extracted: Array<{
      id: string;
      name: string;
      input: Record<string, unknown>;
      originalMatch: string;
    }> = [];

    let toolCallIndex = 0;

    // First try regex patterns for simple cases
    for (const pattern of TOOL_CALL_PATTERNS) {
      // Reset regex state
      pattern.lastIndex = 0;

      let match;
      while ((match = pattern.exec(text)) !== null) {
        const [fullMatch, toolName, argsJson] = match;

        // Verify this is a known tool (prevent hallucinated tools)
        if (!this.availableTools.has(toolName)) {
          continue;
        }

        try {
          const input = JSON.parse(argsJson);
          extracted.push({
            id: `text_tool_${toolCallIndex++}_${Date.now()}`,
            name: toolName,
            input,
            originalMatch: fullMatch,
          });
        } catch (e) {
          // JSON parse failed, skip this match
          continue;
        }
      }
    }

    // If no matches found, try a more robust JSON extraction approach
    if (extracted.length === 0) {
      const jsonObjects = this.extractJsonObjects(text);
      for (const { json, original } of jsonObjects) {
        if (json.name && typeof json.name === 'string' && this.availableTools.has(json.name)) {
          const args = json.arguments || json.parameters || {};
          if (typeof args === 'object') {
            extracted.push({
              id: `text_tool_${toolCallIndex++}_${Date.now()}`,
              name: json.name,
              input: args,
              originalMatch: original,
            });
          }
        }
      }
    }

    return extracted;
  }

  /**
   * Extract JSON objects from text, handling nested braces properly
   */
  private extractJsonObjects(text: string): Array<{ json: any; original: string }> {
    const results: Array<{ json: any; original: string }> = [];
    let i = 0;

    while (i < text.length) {
      if (text[i] === '{') {
        // Try to find matching closing brace
        let depth = 0;
        let start = i;
        let inString = false;
        let escaped = false;

        for (let j = i; j < text.length; j++) {
          const char = text[j];

          if (escaped) {
            escaped = false;
            continue;
          }

          if (char === '\\' && inString) {
            escaped = true;
            continue;
          }

          if (char === '"' && !escaped) {
            inString = !inString;
            continue;
          }

          if (!inString) {
            if (char === '{') depth++;
            if (char === '}') {
              depth--;
              if (depth === 0) {
                const jsonStr = text.substring(start, j + 1);
                try {
                  const parsed = JSON.parse(jsonStr);
                  results.push({ json: parsed, original: jsonStr });
                } catch (e) {
                  // Not valid JSON, skip
                }
                i = j;
                break;
              }
            }
          }
        }
      }
      i++;
    }

    return results;
  }

  /**
   * Try to repair incomplete JSON by adding missing closing characters
   */
  private tryRepairJson(json: string): Record<string, unknown> | null {
    if (!json || json.trim() === '') {
      return null;
    }

    let repaired = json.trim();

    // Count opening and closing braces/brackets
    let braceCount = 0;
    let bracketCount = 0;
    let inString = false;
    let escaped = false;

    for (const char of repaired) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\' && inString) {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
        if (char === '[') bracketCount++;
        if (char === ']') bracketCount--;
      }
    }

    // If we're in the middle of a string, try to close it
    if (inString) {
      repaired += '"';
    }

    // Add missing closing brackets first, then braces
    while (bracketCount > 0) {
      repaired += ']';
      bracketCount--;
    }
    while (braceCount > 0) {
      repaired += '}';
      braceCount--;
    }

    // Try to parse the repaired JSON
    try {
      return JSON.parse(repaired);
    } catch (e) {
      // If still failing, try a more aggressive repair
      // Sometimes the JSON ends mid-value, try to salvage what we can
      try {
        // Try removing the last incomplete key-value pair
        const lastComma = repaired.lastIndexOf(',');
        if (lastComma > 0) {
          const truncated = repaired.substring(0, lastComma);
          // Recount and close
          let bc = 0, brc = 0;
          for (const char of truncated) {
            if (char === '{') bc++;
            if (char === '}') bc--;
            if (char === '[') brc++;
            if (char === ']') brc--;
          }
          let fixed = truncated;
          while (brc > 0) { fixed += ']'; brc--; }
          while (bc > 0) { fixed += '}'; bc--; }
          return JSON.parse(fixed);
        }
      } catch (e2) {
        // Give up
      }
      return null;
    }
  }

  private convertMessages(messages: MessageParam[]): LMStudioMessage[] {
    const lmMessages: LMStudioMessage[] = [];

    // Track if we've injected the system prompt yet
    // We prepend it to the first user message to support models that don't have a system role
    let systemPromptInjected = false;
    const systemPrompt = this.config.systemPrompt;

    for (const msg of messages) {
      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          // Prepend system prompt to first user message
          let content = msg.content;
          if (!systemPromptInjected && systemPrompt) {
            content = `[SYSTEM INSTRUCTIONS]\n${systemPrompt}\n[END SYSTEM INSTRUCTIONS]\n\nUser: ${content}`;
            systemPromptInjected = true;
          }
          lmMessages.push({
            role: 'user',
            content,
          });
        } else if (Array.isArray(msg.content)) {
          // Check if this contains images (multimodal content)
          const hasImages = msg.content.some((block: any) => block.type === 'image');
          const hasToolResults = msg.content.some((block: any) => block.type === 'tool_result');

          if (hasImages && !hasToolResults) {
            // Convert to OpenAI vision format
            const contentParts: LMStudioContentPart[] = [];

            // Prepend system prompt to first user message with images
            if (!systemPromptInjected && systemPrompt) {
              contentParts.push({
                type: 'text',
                text: `[SYSTEM INSTRUCTIONS]\n${systemPrompt}\n[END SYSTEM INSTRUCTIONS]\n\nUser message:`,
              });
              systemPromptInjected = true;
            }

            for (const block of msg.content) {
              if ((block as any).type === 'image') {
                // Convert Anthropic image format to OpenAI format
                const imageBlock = block as any;
                contentParts.push({
                  type: 'image_url',
                  image_url: {
                    url: `data:${imageBlock.source.media_type};base64,${imageBlock.source.data}`,
                    detail: 'auto',
                  },
                });
              } else if ((block as any).type === 'text') {
                contentParts.push({
                  type: 'text',
                  text: (block as any).text,
                });
              }
            }

            lmMessages.push({
              role: 'user',
              content: contentParts,
            });
          } else {
            // Handle tool results and other content
            for (const block of msg.content) {
              if ((block as any).type === 'tool_result') {
                const toolResult = block as any;
                const content = typeof toolResult.content === 'string'
                  ? toolResult.content
                  : JSON.stringify(toolResult.content);

                lmMessages.push({
                  role: 'tool',
                  tool_call_id: toolResult.tool_use_id,
                  content: content,
                });
              } else if ((block as any).type === 'text') {
                // Prepend system prompt to first text user message
                let text = (block as any).text;
                if (!systemPromptInjected && systemPrompt) {
                  text = `[SYSTEM INSTRUCTIONS]\n${systemPrompt}\n[END SYSTEM INSTRUCTIONS]\n\nUser: ${text}`;
                  systemPromptInjected = true;
                }
                lmMessages.push({
                  role: 'user',
                  content: text,
                });
              }
            }
          }
        }
      } else if (msg.role === 'assistant') {
        if (typeof msg.content === 'string') {
          lmMessages.push({
            role: 'assistant',
            content: msg.content,
          });
        } else if (Array.isArray(msg.content)) {
          const textParts: string[] = [];
          const toolCalls: any[] = [];

          for (const block of msg.content) {
            if (block.type === 'text') {
              textParts.push(block.text);
            } else if (block.type === 'tool_use') {
              toolCalls.push({
                id: block.id,
                type: 'function',
                function: {
                  name: block.name,
                  arguments: JSON.stringify(block.input),
                },
              });
            }
          }

          const message: LMStudioMessage = {
            role: 'assistant',
            content: textParts.join('\n') || '',
          };

          if (toolCalls.length > 0) {
            message.tool_calls = toolCalls;
          }

          lmMessages.push(message);
        }
      }
    }

    return lmMessages;
  }

  private convertTools(tools: ToolDefinition[]): LMStudioTool[] {
    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object' as const,
          properties: tool.input_schema.properties,
          required: tool.input_schema.required,
        },
      },
    }));
  }

  getProviderName(): string {
    return 'lmstudio';
  }

  isReasoningModel(): boolean {
    // LM Studio doesn't have built-in reasoning models
    // but could be running a model that does reasoning
    return false;
  }
}
