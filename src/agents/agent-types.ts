/**
 * Type definitions for custom agents
 * Compatible with GitHub Copilot CLI agent.yaml format
 */

/**
 * Prompt construction flags
 */
export interface AgentPromptParts {
  /** Include AI safety instructions */
  includeAISafety?: boolean;
  /** Include tool usage instructions */
  includeToolInstructions?: boolean;
  /** Include parallel tool calling guidance */
  includeParallelToolCalling?: boolean;
  /** Include custom agent instructions */
  includeCustomAgentInstructions?: boolean;
}

/**
 * Agent definition from *.agent.yaml files
 * Compatible with GitHub Copilot CLI format
 */
export interface AgentDefinition {
  /** Unique identifier for the agent */
  name: string;
  /** Human-readable display name */
  displayName: string;
  /** Description of what the agent does and when to use it */
  description: string;
  /** Model to use for this agent (e.g., 'claude-haiku-4.5', 'gpt-4o-mini') */
  model?: string;
  /** List of allowed tools, or ['*'] for all tools */
  tools: string[] | null;
  /** Prompt construction configuration */
  promptParts?: AgentPromptParts;
  /** The agent's system prompt template (supports {{cwd}}, {{branch}}, etc.) */
  prompt: string;
  /** Optional MCP servers specific to this agent */
  mcpServers?: Record<string, unknown>;
  /** Whether this agent can be inferred/auto-selected */
  infer?: boolean;
}

/**
 * Loaded agent with metadata
 */
export interface LoadedAgent {
  /** The parsed agent definition */
  definition: AgentDefinition;
  /** Source file path */
  sourcePath: string;
  /** Source type (copilot, claude-code, custom) */
  sourceType: 'copilot' | 'claude-code' | 'custom';
  /** Whether the agent is currently active */
  active: boolean;
}

/**
 * Template variables available for prompt expansion
 */
export interface PromptTemplateVariables {
  /** Current working directory */
  cwd: string;
  /** Current git branch (if in a git repo) */
  branch?: string;
  /** Repository name */
  repoName?: string;
  /** Current date */
  date: string;
  /** Current time */
  time: string;
  /** Operating system */
  os: string;
  /** Username */
  user: string;
}

/**
 * Agent execution context
 */
export interface AgentExecutionContext {
  /** The agent being executed */
  agent: LoadedAgent;
  /** Template variables for prompt expansion */
  variables: PromptTemplateVariables;
  /** The user's prompt/task */
  userPrompt: string;
  /** Working directory */
  workingDirectory: string;
}

/**
 * Result from agent execution
 */
export interface AgentExecutionResult {
  /** Whether the agent completed successfully */
  success: boolean;
  /** The agent's response */
  response?: string;
  /** Error message if failed */
  error?: string;
  /** Token usage */
  tokenUsage?: {
    input: number;
    output: number;
  };
  /** Execution time in ms */
  executionTime?: number;
}

/**
 * Configuration for agent system
 */
export interface AgentsConfig {
  /** Whether agents are enabled */
  enabled: boolean;
  /** Auto-discover agents from standard paths */
  autoDiscover: boolean;
  /** Additional directories to scan for agents */
  paths: string[];
  /** Disabled agent names */
  disabled: string[];
}
