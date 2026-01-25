/**
 * Base provider interface for LLM providers
 * Enables support for multiple LLM APIs (Anthropic, DeepSeek, etc.)
 */

import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.js';
import type { ToolDefinition, ToolExecutionResult } from '../types.js';

export interface StreamEvent {
  type: 'text_delta' | 'tool_use' | 'message_stop' | 'error';
  content?: string;
  toolUse?: {
    id: string;
    name: string;
    input: Record<string, unknown>;
  };
  error?: string;
}

export interface CompletionResult {
  content: Array<{
    type: 'text' | 'tool_use';
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  stopReason: string | null;
  reasoning?: string; // For reasoning models
  toolCalls?: Array<{
    type: 'tool_use';
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
}

export interface ProviderConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  systemPrompt?: string;
}

export interface StreamOptions {
  onTextDelta?: (text: string) => void;
  onToolUse?: (toolUse: { id: string; name: string; input: Record<string, unknown> }) => void;
  onError?: (error: string) => void;
  abortSignal?: AbortSignal;
}

export abstract class LLMProvider {
  protected config: ProviderConfig;
  protected abortController: AbortController | null = null;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  /**
   * Stream a completion with tool calling support
   */
  abstract streamCompletion(
    messages: MessageParam[],
    tools: ToolDefinition[],
    options?: StreamOptions
  ): Promise<CompletionResult>;

  /**
   * Abort any in-progress completion request
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Create a new AbortController for the current request
   */
  protected createAbortController(): AbortController {
    this.abortController = new AbortController();
    return this.abortController;
  }

  /**
   * Get the provider name
   */
  abstract getProviderName(): string;

  /**
   * Get the model name
   */
  getModel(): string {
    return this.config.model;
  }

  /**
   * Check if this is a reasoning model
   */
  abstract isReasoningModel(): boolean;
}
