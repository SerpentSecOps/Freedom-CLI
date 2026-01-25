/**
 * Anthropic Claude provider implementation
 */

import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ContentBlock } from '@anthropic-ai/sdk/resources/messages.js';
import type { ToolDefinition } from '../types.js';
import { LLMProvider, type ProviderConfig, type CompletionResult, type StreamOptions } from './base.js';
import { getConfig } from '../config.js';

export class AnthropicProvider extends LLMProvider {
  private client: Anthropic;

  constructor(config: ProviderConfig) {
    super(config);
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  async streamCompletion(
    messages: MessageParam[],
    tools: ToolDefinition[],
    options?: StreamOptions
  ): Promise<CompletionResult> {
    // Create abort controller for this request
    const controller = this.createAbortController();

    const stream = await this.client.messages.stream({
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      system: this.config.systemPrompt,
      messages,
      tools,
    }, {
      signal: controller.signal,
    });

    const content: CompletionResult['content'] = [];
    let currentTextBuffer = '';

    // Activity-based timeout: reset timer on each event
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
          controller.abort();
        }, inactivityTimeout);
      }
    };

    // Start initial timer
    resetActivityTimer();

    try {
      // Process streaming events
      for await (const event of stream) {
        // Reset timer on any activity
        resetActivityTimer();

        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'text') {
            currentTextBuffer = '';
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            currentTextBuffer += event.delta.text;
            options?.onTextDelta?.(event.delta.text);
          }
        } else if (event.type === 'content_block_stop') {
          if (currentTextBuffer) {
            content.push({
              type: 'text',
              text: currentTextBuffer,
            });
            currentTextBuffer = '';
          }
        }
      }

      // Get final message to extract tool uses
      const finalMessage = await stream.finalMessage();

      // Add tool uses from final message
      for (const block of finalMessage.content) {
        if (block.type === 'tool_use') {
          const toolUse = {
            type: 'tool_use' as const,
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          };
          content.push(toolUse);
          options?.onToolUse?.(toolUse);
        }
      }

      return {
        content,
        stopReason: finalMessage.stop_reason,
      };
    } catch (error: any) {
      // Check if this was our inactivity timeout
      if (timedOut || error.name === 'AbortError') {
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
    }
  }

  getProviderName(): string {
    return 'anthropic';
  }

  isReasoningModel(): boolean {
    return false; // Claude doesn't have separate reasoning models
  }
}
