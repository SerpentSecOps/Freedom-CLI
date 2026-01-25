/**
 * Provider registry and factory
 */

export { LLMProvider, type ProviderConfig, type CompletionResult, type StreamOptions } from './base.js';
export { AnthropicProvider } from './anthropic.js';
export { DeepSeekProvider } from './deepseek.js';
export { LMStudioProvider } from './lmstudio.js';
export { GoogleAIProvider } from './google-ai.js';
import { AnthropicProvider } from './anthropic.js';
import { DeepSeekProvider } from './deepseek.js';
import { LMStudioProvider } from './lmstudio.js';
import { GoogleAIProvider } from './google-ai.js';
import type { LLMProvider, ProviderConfig } from './base.js';

export type ProviderType = 'anthropic' | 'deepseek' | 'lmstudio' | 'google';

export function createProvider(type: ProviderType, config: ProviderConfig & { baseURL?: string }): LLMProvider {
  switch (type) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'deepseek':
      return new DeepSeekProvider(config);
    case 'lmstudio':
      return new LMStudioProvider(config);
    case 'google':
      return new GoogleAIProvider(config);
    default:
      throw new Error(`Unknown provider type: ${type}`);
  }
}

/**
 * Auto-detect provider from model name
 */
export function detectProviderType(model: string): ProviderType {
  if (model.startsWith('deepseek-')) {
    return 'deepseek';
  }
  if (model.startsWith('claude-')) {
    return 'anthropic';
  }
  if (model.startsWith('lmstudio-') || model === 'local') {
    return 'lmstudio';
  }
  if (
    model.startsWith('gemini-') || 
    model.startsWith('auto-gemini-') ||
    model === 'pro' || 
    model === 'flash' || 
    model === 'flash-lite' || 
    model === 'auto'
  ) {
    return 'google';
  }
  // Default to anthropic for backward compatibility
  return 'anthropic';
}
