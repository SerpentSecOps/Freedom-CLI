/**
 * Context window management
 * Prevents exceeding token limits by intelligently truncating old messages
 * Now supports auto-compression using conversation compression service
 */

import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.js';
import { compressConversation, shouldCompress, getDefaultCompressionConfig, type CompressionMethod } from './conversation-compression.js';
import type { LLMProvider } from './providers/base.js';

/**
 * Estimate token count for a message (rough approximation)
 * Claude's tokenizer is not public, so we use a simple heuristic:
 * ~4 characters per token on average
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessageTokens(message: MessageParam): number {
  if (typeof message.content === 'string') {
    return estimateTokens(message.content);
  }

  let total = 0;
  for (const block of message.content) {
    if (block.type === 'text') {
      total += estimateTokens(block.text);
    } else if (block.type === 'tool_use') {
      total += estimateTokens(JSON.stringify(block.input));
    } else if (block.type === 'tool_result') {
      total += estimateTokens(typeof block.content === 'string' ? block.content : JSON.stringify(block.content));
    }
  }
  return total;
}

/**
 * Truncate messages to fit within context window
 * Strategy:
 * 1. Always keep system prompt budget
 * 2. Keep recent messages (sliding window)
 * 3. Optionally keep first message (user's original request)
 */
export function truncateMessages(
  messages: MessageParam[],
  maxContextTokens: number = 180000, // Claude 3.5 Sonnet has 200k context, leave buffer
  systemPromptTokens: number = 2000,
  keepFirstMessage: boolean = true
): MessageParam[] {
  if (messages.length === 0) {
    return [];
  }

  const availableTokens = maxContextTokens - systemPromptTokens;

  // Calculate token counts
  const messageCounts = messages.map(msg => ({
    message: msg,
    tokens: estimateMessageTokens(msg),
  }));

  const totalTokens = messageCounts.reduce((sum, mc) => sum + mc.tokens, 0);

  // If we're under the limit, no truncation needed
  if (totalTokens <= availableTokens) {
    return messages;
  }

  // We need to truncate - keep recent messages and optionally first message
  const result: MessageParam[] = [];
  let currentTokens = 0;

  // Reserve tokens for first message if keeping it
  const firstMessageTokens = keepFirstMessage ? messageCounts[0].tokens : 0;
  const tokensForRecent = availableTokens - firstMessageTokens;

  // Add messages from the end (most recent) until we hit the limit
  for (let i = messageCounts.length - 1; i >= 0; i--) {
    const mc = messageCounts[i];

    // Skip first message for now if we're keeping it
    if (i === 0 && keepFirstMessage) {
      continue;
    }

    if (currentTokens + mc.tokens <= tokensForRecent) {
      result.unshift(mc.message);
      currentTokens += mc.tokens;
    } else {
      // Can't fit any more messages
      break;
    }
  }

  // Add first message at the beginning if keeping it
  if (keepFirstMessage && messages.length > 0) {
    result.unshift(messages[0]);
  }

  return result;
}

/**
 * Check if messages are approaching context limit
 */
export function isApproachingContextLimit(
  messages: MessageParam[],
  warningThreshold: number = 160000 // Warn at 80% of 200k
): boolean {
  const totalTokens = messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
  return totalTokens > warningThreshold;
}

/**
 * Calculate context usage statistics
 */
export function getContextUsage(
  messages: MessageParam[],
  maxContextTokens: number = 180000,
  systemPromptTokens: number = 2000
): {
  totalTokens: number;
  maxTokens: number;
  percentage: number;
  remaining: number;
} {
  const totalTokens = messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
  const availableTokens = maxContextTokens - systemPromptTokens;
  const percentage = (totalTokens / availableTokens) * 100;
  const remaining = availableTokens - totalTokens;

  return {
    totalTokens,
    maxTokens: availableTokens,
    percentage: Math.min(percentage, 100), // Cap at 100%
    remaining: Math.max(remaining, 0), // Don't show negative
  };
}

/**
 * Auto-compress messages if enabled and threshold is reached
 * This should be called BEFORE hitting the context limit to prevent work stoppage
 */
export async function autoCompressIfNeeded(
  messages: MessageParam[],
  config: {
    autoCompact?: boolean;
    compactMethod?: CompressionMethod;
    contextLimit?: number;
  },
  provider?: LLMProvider
): Promise<{ messages: MessageParam[]; compressed: boolean; stats?: any }> {
  // Skip if auto-compact is disabled
  if (!config.autoCompact) {
    return { messages, compressed: false };
  }

  const contextLimit = config.contextLimit || 180000;
  const compressionConfig = getDefaultCompressionConfig(contextLimit);
  compressionConfig.method = config.compactMethod || 'smart';

  // Check if we should compress
  if (shouldCompress(messages, compressionConfig)) {
    try {
      const result = await compressConversation(messages, compressionConfig, provider);

      return {
        messages: result.compressedMessages,
        compressed: true,
        stats: {
          originalCount: result.originalCount,
          compressedCount: result.compressedCount,
          originalTokens: result.originalTokens,
          compressedTokens: result.compressedTokens,
          savedTokens: result.savedTokens,
          method: result.method,
        },
      };
    } catch (error) {
      console.warn('Auto-compression failed, falling back to truncation:', error);
      return { messages, compressed: false };
    }
  }

  return { messages, compressed: false };
}
