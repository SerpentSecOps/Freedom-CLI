/**
 * DeepSeek provider implementation
 * Supports both deepseek-chat and deepseek-reasoner models
 */

import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.js';
import type { ToolDefinition } from '../types.js';
import { LLMProvider, type ProviderConfig, type CompletionResult, type StreamOptions } from './base.js';
import { getConfig } from '../config.js';

interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
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

interface DeepSeekTool {
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

interface DeepSeekStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      reasoning_content?: string;
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

export class DeepSeekProvider extends LLMProvider {
  private baseURL = 'https://api.deepseek.com';

  constructor(config: ProviderConfig) {
    super(config);
  }

  async streamCompletion(
    messages: MessageParam[],
    tools: ToolDefinition[],
    options?: StreamOptions
  ): Promise<CompletionResult> {
    const deepseekMessages = this.convertMessages(messages);
    const deepseekTools = this.convertTools(tools);

    // Create abort controller for this request
    const abortController = this.createAbortController();

    const requestBody: any = {
      model: this.config.model,
      messages: deepseekMessages,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      stream: true,
    };

    // Add tools if provided
    if (deepseekTools.length > 0) {
      requestBody.tools = deepseekTools;
      requestBody.tool_choice = 'auto';
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('Request aborted by user');
      }
      throw error;
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DeepSeek API error: ${response.status} - ${errorText}`);
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

    const decoder = new TextDecoder();
    const content: CompletionResult['content'] = [];
    let textBuffer = '';
    let reasoningBuffer = '';
    let stopReason: string | null = null;

    // Track tool calls being built across chunks
    const toolCallsMap = new Map<number, {
      id?: string;
      name?: string;
      arguments: string;
    }>();

    // Activity-based timeout: reset timer on each chunk received
    const cliConfig = getConfig();
    const inactivityTimeout = cliConfig.apiTimeout || 180000;
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
              const parsed: DeepSeekStreamChunk = JSON.parse(data);
              const choice = parsed.choices[0];

              if (!choice) continue;

              // Handle text content
              if (choice.delta.content) {
                textBuffer += choice.delta.content;
                options?.onTextDelta?.(choice.delta.content);
              }

              // Handle reasoning content (for reasoning models)
              if (choice.delta.reasoning_content) {
                reasoningBuffer += choice.delta.reasoning_content;
              }

              // Handle tool calls
              if (choice.delta.tool_calls) {
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
              // Skip malformed JSON
              console.error('Failed to parse SSE data:', e);
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

    // Add text content if any
    if (textBuffer) {
      content.push({
        type: 'text',
        text: textBuffer,
      });
    }

    // Add tool calls to content
    for (const [_, toolCall] of toolCallsMap) {
      if (toolCall.id && toolCall.name) {
        try {
          // Debug: show raw arguments before parsing
          console.error(`\n[DeepSeek DEBUG] Tool call: ${toolCall.name}`);
          console.error(`[DeepSeek DEBUG] Raw arguments string: "${toolCall.arguments}"`);
          
          const input = JSON.parse(toolCall.arguments || '{}');
          
          console.error(`[DeepSeek DEBUG] Parsed input keys: ${Object.keys(input).join(', ') || '(empty)'}`);
          console.error(`[DeepSeek DEBUG] Parsed input: ${JSON.stringify(input)}`);
          
          const toolUse = {
            type: 'tool_use' as const,
            id: toolCall.id,
            name: toolCall.name,
            input,
          };
          content.push(toolUse);
          options?.onToolUse?.(toolUse);
        } catch (e) {
          console.error('Failed to parse tool arguments:', e);
          console.error('Raw arguments were:', toolCall.arguments);
        }
      }
    }

    return {
      content,
      stopReason,
      reasoning: reasoningBuffer || undefined,
    };
  }

  private convertMessages(messages: MessageParam[]): DeepSeekMessage[] {
    const deepseekMessages: DeepSeekMessage[] = [];

    // Add system message if configured
    if (this.config.systemPrompt) {
      deepseekMessages.push({
        role: 'system',
        content: this.config.systemPrompt,
      });
    }

    for (const msg of messages) {
      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          deepseekMessages.push({
            role: 'user',
            content: msg.content,
          });
        } else if (Array.isArray(msg.content)) {
          // Handle tool results
          const toolResults: string[] = [];
          for (const block of msg.content) {
            if (block.type === 'tool_result') {
              const content = typeof block.content === 'string'
                ? block.content
                : JSON.stringify(block.content);

              deepseekMessages.push({
                role: 'tool',
                tool_call_id: block.tool_use_id,
                content: content,
              });
            } else if (block.type === 'text') {
              toolResults.push(block.text);
            }
          }

          // If there were text blocks, add them as a user message
          if (toolResults.length > 0) {
            deepseekMessages.push({
              role: 'user',
              content: toolResults.join('\n'),
            });
          }
        }
      } else if (msg.role === 'assistant') {
        if (typeof msg.content === 'string') {
          deepseekMessages.push({
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

          const message: DeepSeekMessage = {
            role: 'assistant',
            content: textParts.join('\n') || '',
          };

          if (toolCalls.length > 0) {
            message.tool_calls = toolCalls;
          }

          deepseekMessages.push(message);
        }
      }
    }

    return deepseekMessages;
  }

  private convertTools(tools: ToolDefinition[]): DeepSeekTool[] {
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
    return 'deepseek';
  }

  isReasoningModel(): boolean {
    return this.config.model === 'deepseek-reasoner';
  }
}
