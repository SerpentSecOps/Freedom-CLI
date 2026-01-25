/**
 * Core type definitions for the agentic CLI
 * Architecture inspired by Codex (Rust) and Gemini CLI patterns
 */

import type { MessageParam, TextBlock, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages.js';
import type { MCPServerConfig } from './mcp-types.js';

// ============================================================================
// Tool System Types
// ============================================================================

export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

export interface ToolExecutionContext {
  workingDirectory: string;
  environment: Record<string, string>;
  sessionId: string;
  // SSH Remote Execution (added for VM/container isolation)
  sshConnection?: string; // SSH connection ID (if in remote mode)
  executionMode?: 'local' | 'remote'; // Execution mode
  // Sandbox mode - when true, tools are restricted to working directory only
  // Used in continuous loop (/cl) mode to prevent unsupervised AI from escaping
  sandboxed?: boolean;
}

export interface ToolExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface Tool {
  definition: ToolDefinition;
  execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult>;
  shouldConfirm?(input: Record<string, unknown>): boolean;
  // Optional method to block commands in sandboxed mode - returns error message if blocked, null otherwise
  shouldBlock?(input: Record<string, unknown>, context: ToolExecutionContext): string | null;
}

// ============================================================================
// Agent Loop Types
// ============================================================================

export interface Turn {
  id: string;
  timestamp: number;
  userMessage?: string;
  assistantMessages: Array<{
    type: 'text' | 'tool_use';
    content: string | ToolUseBlock;
  }>;
  toolCalls: ToolCall[];
  stopReason: string | null;
  /** Thinking/reasoning content from the model (not included in context) */
  thinking?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result: ToolExecutionResult;
  timestamp: number;
  approved: boolean;
}

export interface AgentConfig {
  model: string;
  maxTokens: number;
  temperature: number;
  systemPrompt: string;
  autoApprove: boolean;
  maxTurns: number;
}

// ============================================================================
// Session & Storage Types
// ============================================================================

export interface SessionMetadata {
  id: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  workingDirectory: string;
  totalTurns: number;
  totalTokens: number;
}

export interface StoredMessage {
  role: 'user' | 'assistant';
  content: string | Array<TextBlock | ToolUseBlock>;
  timestamp: number;
}

export interface Session {
  metadata: SessionMetadata;
  messages: MessageParam[];
  turns: Turn[];
}

// ============================================================================
// Event System Types (for streaming)
// ============================================================================

export type AgentEvent =
  | { type: 'turn_start'; turnId: string }
  | { type: 'content_delta'; delta: string }
  | { type: 'tool_call_request'; toolCall: { id: string; name: string; input: Record<string, unknown> } }
  | { type: 'tool_call_result'; toolCallId: string; result: ToolExecutionResult }
  | { type: 'turn_complete'; turn: Turn }
  | { type: 'error'; error: Error }
  | { type: 'session_end'; reason: string };

// ============================================================================
// Configuration Types
// ============================================================================

export interface AgenticCliConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  autoApprove: boolean;
  maxTurns: number;
  dataDir: string;
  systemPrompt?: string;
  mcpServers?: Record<string, MCPServerConfig>;
  // Provider-specific config
  provider?: 'anthropic' | 'deepseek' | 'lmstudio' | 'google'; // Auto-detected from model if not specified
  deepseekApiKey?: string; // DeepSeek API key (if different from apiKey)
  lmstudioBaseURL?: string; // LM Studio server URL (default: http://localhost:1234/v1)
  // Compression config
  autoCompact?: boolean; // Auto-compress when approaching context limit
  compactMethod?: 'semantic' | 'simple' | 'smart'; // Compression method (default: smart)
  contextLimit?: number; // Max context tokens (default: 180000)
  // Quarantined paths (directories that should never be accessed)
  quarantinedPaths?: string[]; // List of paths that the LLM cannot access
  // Session cleanup config
  sessionCleanup?: {
    enabled: boolean;
    maxAge?: string;      // e.g., "30d", "7d", "24h"
    maxCount?: number;    // Keep only N most recent sessions
    minRetention?: string; // Minimum retention period (default: "1d")
  };
  // Skills config (Claude Code compatibility)
  skills?: {
    enabled: boolean;      // Enable/disable skills system
    autoLoad: boolean;     // Auto-load skills on startup
    paths: string[];       // Directories to scan for skills
    marketplaces: string[]; // marketplace.json files to load
  };
  // Plugins config (Claude Code compatibility)
  plugins?: {
    enabled: boolean;      // Enable/disable plugins system
    autoLoad: boolean;     // Auto-load plugins on startup
    paths: string[];       // Directories to scan for plugins
    marketplaces: string[]; // marketplace.json files to load
  };
  // Disabled tools (tools to exclude from LLM)
  disabledTools?: string[];
  // Timeout settings (in milliseconds internally)
  apiTimeout?: number;  // API call timeout (default: 600000ms = 10 min for LM Studio)
  toolTimeout?: number; // Tool execution timeout (default: 300000ms = 5 min for LM Studio)
  // LM Studio specific settings
  lmstudioRetries?: number;     // Number of connection retries (default: 3)
  lmstudioRetryDelay?: number;  // Initial retry delay in ms (default: 2000)
  // Tool history archival setting
  historyKeepTurns?: number;       // Master setting (legacy/convenience)
  historyKeepInputTurns?: number;  // Specific setting for inputs (assistant msgs)
  historyKeepOutputTurns?: number; // Specific setting for outputs (user tool results)
  historyArchiveLimit?: number;    // Threshold to start archiving (default 500)
  historyOutputLimit?: number;     // Hard cap for tool output in context (default 5000)
  historyInputHeadCharacters?: number; // Chars to keep at start of archived input (default 200)
  historyInputTailCharacters?: number; // Chars to keep at end of archived input (default 100)
  // API Key Storage Preference
  apiKeyStorage?: 'env' | 'file'; // Where to save new keys (default: env)
  // Continuous mode config (unsupervised autonomous operation)
  continuousMode?: {
    // Tools allowed in continuous mode (default: minimal coding tools only)
    // If not specified, uses CONTINUOUS_MODE_DEFAULT_TOOLS
    allowedTools?: string[];
    // Additional tools to enable beyond the defaults
    additionalTools?: string[];
    // Tools to explicitly disable even if in allowedTools
    disabledTools?: string[];
    // Whether to load MCP servers in continuous mode (default: false)
    enableMcp?: boolean;
    // Whether to enable web tools in continuous mode (default: false)
    enableWeb?: boolean;
  };
}
