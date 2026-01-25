/**
 * Type definitions for Claude Code plugin compatibility
 */

/**
 * Plugin manifest from .claude-plugin/plugin.json
 */
export interface PluginManifest {
  /** Plugin name */
  name: string;
  /** Plugin version */
  version?: string;
  /** Plugin description */
  description?: string;
  /** Author information */
  author?: {
    name: string;
    email: string;
  };
  /** Homepage URL */
  homepage?: string;
  /** Path to commands directory (relative to plugin root) */
  commands?: string;
  /** Array of paths to agent directories */
  agents?: string[];
  /** Path to hooks.json file */
  hooks?: string;
  /** Path to .mcp.json file for MCP servers */
  mcpServers?: string;
  /** Path to embedded skills */
  skills?: string[];
  /** Path to lsp-servers.json file for LSP servers */
  lspServers?: string;
}

/**
 * Command definition from commands/*.md files
 */
export interface CommandDefinition {
  /** Command name (from filename without .md) */
  name: string;
  /** Command description */
  description: string;
  /** Argument hint (e.g., "[arg1] [arg2]") */
  argumentHint?: string;
  /** Allowed tools for this command */
  allowedTools?: string[];
  /** Model to use for this command */
  model?: string;
  /** Command instructions (body after frontmatter) */
  instructions: string;
  /** File path where command was loaded from */
  path: string;
}

/**
 * Agent definition from agents/*.md files
 */
export interface AgentDefinition {
  /** Agent name */
  name: string;
  /** When to use this agent */
  description: string;
  /** Model to use (or 'inherit') */
  model?: string;
  /** Agent color for UI */
  color?: string;
  /** Tools available to this agent */
  tools?: string[];
  /** Agent instructions (body after frontmatter) */
  instructions: string;
  /** File path where agent was loaded from */
  path: string;
}

/**
 * Hook types
 */
export type HookType = 'command' | 'prompt';

/**
 * Hook events
 */
export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'
  | 'SubagentStop'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'SessionEnd'
  | 'PreCompact'
  | 'Notification';

/**
 * Hook definition
 */
export interface Hook {
  /** Hook name */
  name: string;
  /** Hook type (command or prompt) */
  type: HookType;
  /** Event to trigger on */
  event: HookEvent;
  /** Command to execute (for command hooks) */
  command?: string;
  /** Prompt template (for prompt hooks) */
  prompt?: string;
  /** Working directory for command execution */
  cwd?: string;
  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * Hooks configuration from hooks.json
 */
export interface HooksConfig {
  hooks: Hook[];
}

/**
 * Hook execution result
 */
export interface HookResult {
  /** Hook that was executed */
  hook: Hook;
  /** Whether hook succeeded */
  success: boolean;
  /** Output from hook */
  output?: string;
  /** Error if failed */
  error?: string;
  /** Whether to block the action */
  block?: boolean;
  /** Modified input (for PreToolUse hooks) */
  modifiedInput?: any;
}

/**
 * Loaded plugin with all components
 */
export interface LoadedPlugin {
  /** Plugin manifest */
  manifest: PluginManifest;
  /** Plugin root directory */
  path: string;
  /** Loaded commands */
  commands: Map<string, CommandDefinition>;
  /** Loaded agents */
  agents: Map<string, AgentDefinition>;
  /** Loaded hooks */
  hooks: Hook[];
  /** Loaded LSP servers */
  lspServers: Map<string, any>; // Using any for now, should be LSPServerConfig
  /** Loaded MCP servers */
  mcpServers: Map<string, any>; // Using any for now, should be MCPServerConfig
  /** Whether plugin is active */
  active: boolean;
}

/**
 * Plugin configuration from config.json
 */
export interface PluginsConfig {
  /** Whether plugins are enabled */
  enabled: boolean;
  /** Automatically load plugins on startup */
  autoLoad: boolean;
  /** Directories to scan for plugins */
  paths: string[];
  /** Marketplace.json files to load plugins from */
  marketplaces: string[];
}

/**
 * Plugin marketplace entry
 */
export interface PluginMarketplaceEntry {
  /** Plugin name */
  name: string;
  /** Plugin description */
  description: string;
  /** Source (local path or git URL) */
  source: string | {
    source: 'local' | 'url';
    url?: string;
    path?: string;
  };
  /** Optional category */
  category?: string;
  /** Optional homepage */
  homepage?: string;
  /** Optional version */
  version?: string;
  /** Strict mode */
  strict?: boolean;
}
