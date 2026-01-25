/**
 * Conversation Compression Service
 * Implements multiple compression strategies based on research:
 * - Semantic: LLM-based with structured extraction (RECOMMENDED)
 * - Simple: Heuristic-based keyword extraction
 * - Smart: Adaptive based on conversation size
 */

import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.js';
import type { LLMProvider } from './providers/base.js';

// ============================================================================
// Types
// ============================================================================

export type CompressionMethod = 'semantic' | 'simple' | 'smart';

export interface CompressionConfig {
  method: CompressionMethod;
  maxContextTokens: number;
  compressThreshold: number; // 0-1, percentage of context to trigger compression
  preserveRatio: number; // 0-1, percentage of recent messages to keep
}

export interface CompressionResult {
  compressedMessages: MessageParam[];
  originalTokens: number;
  compressedTokens: number;
  savedTokens: number;
  compressionRatio: number;
  originalCount: number;
  compressedCount: number;
  method: CompressionMethod;
}

interface SemanticExtraction {
  keyDecisions: string[];
  fileReferences: string[];
  errors: string[];
  objectives: string[];
  toolUsage: Record<string, number>;
}

// ============================================================================
// Token Estimation (4 chars per token heuristic)
// ============================================================================

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

function calculateTotalTokens(messages: MessageParam[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

// ============================================================================
// Semantic Extraction
// ============================================================================

function extractSemanticInfo(messages: MessageParam[]): SemanticExtraction {
  const extraction: SemanticExtraction = {
    keyDecisions: [],
    fileReferences: [],
    errors: [],
    objectives: [],
    toolUsage: {},
  };

  const filePathRegex = /(?:\/[\w.-]+)+\.\w+|(?:[\w-]+\/)+[\w.-]+\.\w+/g;
  const decisionKeywords = ['decided', 'chose', 'selected', 'implemented', 'created', 'fixed', 'updated'];
  const errorKeywords = ['error', 'failed', 'exception', 'bug', 'issue', 'problem'];

  for (const msg of messages) {
    const textContent = extractTextContent(msg);

    // Extract file references
    const filePaths = textContent.match(filePathRegex);
    if (filePaths) {
      extraction.fileReferences.push(...filePaths);
    }

    // Extract key decisions
    for (const keyword of decisionKeywords) {
      const regex = new RegExp(`(${keyword}[^.!?]*[.!?])`, 'gi');
      const matches = textContent.match(regex);
      if (matches) {
        extraction.keyDecisions.push(...matches);
      }
    }

    // Extract errors
    for (const keyword of errorKeywords) {
      const regex = new RegExp(`(${keyword}[^.!?]*[.!?])`, 'gi');
      const matches = textContent.match(regex);
      if (matches) {
        extraction.errors.push(...matches);
      }
    }

    // Extract objectives from user messages
    if (msg.role === 'user') {
      const sentences = textContent.split(/[.!?]+/).filter(s => s.trim().length > 10);
      if (sentences.length > 0) {
        extraction.objectives.push(sentences[0].trim());
      }
    }

    // Count tool usage
    if (typeof msg.content !== 'string') {
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          extraction.toolUsage[block.name] = (extraction.toolUsage[block.name] || 0) + 1;
        }
      }
    }
  }

  // Deduplicate
  extraction.fileReferences = [...new Set(extraction.fileReferences)];
  extraction.keyDecisions = [...new Set(extraction.keyDecisions)].slice(0, 10);
  extraction.errors = [...new Set(extraction.errors)].slice(0, 5);
  extraction.objectives = [...new Set(extraction.objectives)].slice(0, 5);

  return extraction;
}

function extractTextContent(message: MessageParam): string {
  if (typeof message.content === 'string') {
    return message.content;
  }

  return message.content
    .filter(block => block.type === 'text')
    .map(block => (block as any).text)
    .join(' ');
}

// ============================================================================
// Compression Methods
// ============================================================================

async function semanticCompression(
  messages: MessageParam[],
  config: CompressionConfig,
  provider?: LLMProvider
): Promise<CompressionResult> {
  const originalTokens = calculateTotalTokens(messages);
  const tokensToKeep = Math.floor(originalTokens * config.preserveRatio);

  // Calculate split point
  const splitIndex = findSplitPoint(messages, tokensToKeep);

  if (splitIndex >= messages.length - 1) {
    // Not enough to compress
    return {
      compressedMessages: messages,
      originalTokens,
      compressedTokens: originalTokens,
      savedTokens: 0,
      compressionRatio: 1.0,
      originalCount: messages.length,
      compressedCount: messages.length,
      method: 'semantic',
    };
  }

  const messagesToCompress = messages.slice(0, splitIndex);
  const recentMessages = messages.slice(splitIndex);

  // Extract semantic information
  const extraction = extractSemanticInfo(messagesToCompress);

  // Generate summary
  let summaryText: string;
  if (provider) {
    try {
      summaryText = await generateLLMSummary(messagesToCompress, extraction, provider);
    } catch (error) {
      console.warn('LLM summarization failed, falling back to simple extraction');
      summaryText = generateSimpleSummary(extraction);
    }
  } else {
    summaryText = generateSimpleSummary(extraction);
  }

  // Create summary message
  const summaryMessage: MessageParam = {
    role: 'assistant',
    content: `[CONVERSATION SUMMARY - ${messagesToCompress.length} messages compressed]\n\n${summaryText}`,
  };

  const compressedMessages = [summaryMessage, ...recentMessages];
  const compressedTokens = calculateTotalTokens(compressedMessages);

  return {
    compressedMessages,
    originalTokens,
    compressedTokens,
    savedTokens: originalTokens - compressedTokens,
    compressionRatio: compressedTokens / originalTokens,
    originalCount: messages.length,
    compressedCount: compressedMessages.length,
    method: 'semantic',
  };
}

async function simpleCompression(
  messages: MessageParam[],
  config: CompressionConfig
): Promise<CompressionResult> {
  const originalTokens = calculateTotalTokens(messages);
  const tokensToKeep = Math.floor(originalTokens * config.preserveRatio);

  const splitIndex = findSplitPoint(messages, tokensToKeep);

  if (splitIndex >= messages.length - 1) {
    return {
      compressedMessages: messages,
      originalTokens,
      compressedTokens: originalTokens,
      savedTokens: 0,
      compressionRatio: 1.0,
      originalCount: messages.length,
      compressedCount: messages.length,
      method: 'simple',
    };
  }

  const messagesToCompress = messages.slice(0, splitIndex);
  const recentMessages = messages.slice(splitIndex);

  const extraction = extractSemanticInfo(messagesToCompress);
  const summaryText = generateSimpleSummary(extraction);

  const summaryMessage: MessageParam = {
    role: 'assistant',
    content: `[CONVERSATION SUMMARY - ${messagesToCompress.length} messages compressed]\n\n${summaryText}`,
  };

  const compressedMessages = [summaryMessage, ...recentMessages];
  const compressedTokens = calculateTotalTokens(compressedMessages);

  return {
    compressedMessages,
    originalTokens,
    compressedTokens,
    savedTokens: originalTokens - compressedTokens,
    compressionRatio: compressedTokens / originalTokens,
    originalCount: messages.length,
    compressedCount: compressedMessages.length,
    method: 'simple',
  };
}

async function smartCompression(
  messages: MessageParam[],
  config: CompressionConfig,
  provider?: LLMProvider
): Promise<CompressionResult> {
  const totalTokens = calculateTotalTokens(messages);

  // Choose method based on context size
  if (totalTokens < 8000) {
    // Small conversation, use simple
    return simpleCompression(messages, config);
  } else if (provider && totalTokens > 50000) {
    // Large conversation with LLM available, use semantic
    return semanticCompression(messages, config, provider);
  } else {
    // Medium size or no LLM, use simple
    return simpleCompression(messages, config);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function findSplitPoint(messages: MessageParam[], tokensToKeep: number): number {
  let accumulatedTokens = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = estimateMessageTokens(messages[i]);
    if (accumulatedTokens + msgTokens > tokensToKeep) {
      // Find safe split point (prefer user message)
      for (let j = i; j < messages.length; j++) {
        if (messages[j].role === 'user') {
          return j;
        }
      }
      return i + 1;
    }
    accumulatedTokens += msgTokens;
  }
  return 0;
}

function generateSimpleSummary(extraction: SemanticExtraction): string {
  let summary = '## Summary\n\n';

  if (extraction.objectives.length > 0) {
    summary += '**Objectives:**\n';
    extraction.objectives.forEach(obj => {
      summary += `- ${obj}\n`;
    });
    summary += '\n';
  }

  if (extraction.keyDecisions.length > 0) {
    summary += '**Key Actions:**\n';
    extraction.keyDecisions.slice(0, 5).forEach(decision => {
      summary += `- ${decision.trim()}\n`;
    });
    summary += '\n';
  }

  if (extraction.fileReferences.length > 0) {
    summary += '**Files Referenced:**\n';
    extraction.fileReferences.slice(0, 10).forEach(file => {
      summary += `- ${file}\n`;
    });
    summary += '\n';
  }

  if (extraction.errors.length > 0) {
    summary += '**Issues Encountered:**\n';
    extraction.errors.forEach(error => {
      summary += `- ${error.trim()}\n`;
    });
    summary += '\n';
  }

  if (Object.keys(extraction.toolUsage).length > 0) {
    summary += '**Tools Used:**\n';
    Object.entries(extraction.toolUsage)
      .sort((a, b) => b[1] - a[1])
      .forEach(([tool, count]) => {
        summary += `- ${tool}: ${count}x\n`;
      });
  }

  return summary;
}

async function generateLLMSummary(
  messages: MessageParam[],
  extraction: SemanticExtraction,
  provider: LLMProvider
): Promise<string> {
  const conversationText = messages
    .map(msg => {
      const text = extractTextContent(msg);
      return `${msg.role.toUpperCase()}: ${text.slice(0, 500)}${text.length > 500 ? '...' : ''}`;
    })
    .join('\n\n');

  const prompt = `Please create a concise summary of this conversation. Focus on:
1. Main topics and objectives
2. Key decisions and actions taken
3. Important code or files mentioned
4. Unresolved questions or next steps

Keep the summary under 500 words and use markdown formatting.

CONVERSATION:
${conversationText}

EXTRACTED INFO:
- Files: ${extraction.fileReferences.slice(0, 5).join(', ')}
- Tools used: ${Object.keys(extraction.toolUsage).join(', ')}

SUMMARY:`;

  // Use streamCompletion but collect the full response
  let summaryText = '';
  const result = await provider.streamCompletion(
    [{ role: 'user', content: prompt }],
    [], // No tools needed
    {
      onTextDelta: (text) => {
        summaryText += text;
      },
    }
  );

  // Extract text from result if streaming didn't capture it
  if (!summaryText && result.content) {
    for (const block of result.content) {
      if (block.type === 'text' && block.text) {
        summaryText += block.text;
      }
    }
  }

  return summaryText || generateSimpleSummary(extraction);
}

// ============================================================================
// Public API
// ============================================================================

export async function compressConversation(
  messages: MessageParam[],
  config: CompressionConfig,
  provider?: LLMProvider
): Promise<CompressionResult> {
  // Always preserve system messages (if any)
  const systemMessages = messages.filter(m => (m as any).role === 'system');
  const conversationMessages = messages.filter(m => (m as any).role !== 'system');

  let result: CompressionResult;

  switch (config.method) {
    case 'semantic':
      result = await semanticCompression(conversationMessages, config, provider);
      break;
    case 'simple':
      result = await simpleCompression(conversationMessages, config);
      break;
    case 'smart':
      result = await smartCompression(conversationMessages, config, provider);
      break;
    default:
      result = await smartCompression(conversationMessages, config, provider);
  }

  // Add system messages back at the beginning
  if (systemMessages.length > 0) {
    result.compressedMessages = [...systemMessages, ...result.compressedMessages];
  }

  return result;
}

export function shouldCompress(messages: MessageParam[], config: CompressionConfig): boolean {
  const totalTokens = calculateTotalTokens(messages);
  const threshold = config.maxContextTokens * config.compressThreshold;
  return totalTokens >= threshold;
}

export function getDefaultCompressionConfig(maxContextTokens: number = 180000): CompressionConfig {
  // Adaptive thresholds based on context window size
  let compressThreshold: number;
  let preserveRatio: number;

  if (maxContextTokens <= 4000) {
    compressThreshold = 0.6; // Compress at 60%
    preserveRatio = 0.25; // Keep 25% of recent
  } else if (maxContextTokens <= 8000) {
    compressThreshold = 0.65;
    preserveRatio = 0.25;
  } else if (maxContextTokens <= 16000) {
    compressThreshold = 0.7;
    preserveRatio = 0.3;
  } else if (maxContextTokens <= 40000) {
    compressThreshold = 0.75;
    preserveRatio = 0.3;
  } else {
    compressThreshold = 0.8; // Large context, compress at 80%
    preserveRatio = 0.3; // Keep 30% of recent
  }

  return {
    method: 'smart',
    maxContextTokens,
    compressThreshold,
    preserveRatio,
  };
}
