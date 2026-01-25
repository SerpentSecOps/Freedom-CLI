/**
 * Tool Registry - Central management for all available tools
 * Inspired by Codex's ToolRouter and Gemini's tool registration patterns
 */

import type { Tool, ToolDefinition, ToolExecutionContext, ToolExecutionResult } from '../types.js';
import { getConfig } from '../config.js';

/**
 * Default tools for continuous mode - minimal set for unsupervised coding
 * These are the bare essentials needed for autonomous coding tasks
 */
export const CONTINUOUS_MODE_DEFAULT_TOOLS = [
  'bash',           // Execute commands
  'read',           // Read files
  'write',          // Write files
  'edit',           // Edit files
  'glob',           // Find files
  'grep',           // Search content
  'git_status',     // Check git state
  'git_diff',       // View changes
  'git_add',        // Stage files
  'git_commit',     // Commit changes
  'task_output',    // Get background task output
  'lsp',            // Code intelligence
  'path_info',      // Path utilities
];

/**
 * Web-related tools (disabled by default in continuous mode)
 */
export const WEB_TOOLS = [
  'web_search',
  'web_fetch',
];

/**
 * Git tools that might be risky in continuous mode
 */
export const GIT_EXTENDED_TOOLS = [
  'git_push',       // Pushing to remote
  'git_branch',     // Branch management
  'git_checkout',   // Switching branches
  'git_log',        // View history
];

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private continuousModeActive: boolean = false;

  public register(tool: Tool): void {
    this.tools.set(tool.definition.name, tool);
  }

  public unregister(name: string): void {
    this.tools.delete(name);
  }

  public getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Enable continuous mode (minimal tools for unsupervised operation)
   */
  public setContinuousMode(enabled: boolean): void {
    this.continuousModeActive = enabled;
  }

  /**
   * Check if continuous mode is active
   */
  public isContinuousMode(): boolean {
    return this.continuousModeActive;
  }

  /**
   * Get all registered tools (including disabled ones)
   */
  public getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get the list of allowed tools based on mode and config
   */
  private getAllowedToolNames(): Set<string> {
    const config = getConfig();
    const disabledTools: string[] = config.disabledTools || [];

    // If not in continuous mode, allow all except explicitly disabled
    if (!this.continuousModeActive) {
      const allTools = new Set(this.tools.keys());
      for (const disabled of disabledTools) {
        allTools.delete(disabled);
      }
      return allTools;
    }

    // Continuous mode: start with defaults or custom allowlist
    const continuousConfig = config.continuousMode;
    let allowedTools: Set<string>;

    if (continuousConfig?.allowedTools) {
      // Use custom allowlist
      allowedTools = new Set(continuousConfig.allowedTools);
    } else {
      // Use default minimal toolset
      allowedTools = new Set(CONTINUOUS_MODE_DEFAULT_TOOLS);
    }

    // Add web tools if explicitly enabled
    if (continuousConfig?.enableWeb) {
      for (const tool of WEB_TOOLS) {
        allowedTools.add(tool);
      }
    }

    // Add any additional tools from config
    if (continuousConfig?.additionalTools) {
      for (const tool of continuousConfig.additionalTools) {
        allowedTools.add(tool);
      }
    }

    // Remove any tools in the disabled list
    if (continuousConfig?.disabledTools) {
      for (const tool of continuousConfig.disabledTools) {
        allowedTools.delete(tool);
      }
    }

    // Also respect global disabledTools
    for (const disabled of disabledTools) {
      allowedTools.delete(disabled);
    }

    return allowedTools;
  }

  /**
   * Get only enabled tools (respects continuous mode and disabledTools config)
   */
  public getEnabledTools(): Tool[] {
    const allowedNames = this.getAllowedToolNames();
    return Array.from(this.tools.values()).filter(
      tool => allowedNames.has(tool.definition.name)
    );
  }

  /**
   * Get tool definitions for enabled tools only
   */
  public getToolDefinitions(): ToolDefinition[] {
    return this.getEnabledTools().map(tool => tool.definition);
  }

  /**
   * Check if a tool is enabled (respects continuous mode)
   */
  public isToolEnabled(name: string): boolean {
    const allowedNames = this.getAllowedToolNames();
    return allowedNames.has(name);
  }

  /**
   * Get a summary of tool availability for logging/debugging
   */
  public getToolSummary(): { total: number; enabled: number; mode: string } {
    return {
      total: this.tools.size,
      enabled: this.getEnabledTools().length,
      mode: this.continuousModeActive ? 'continuous' : 'normal',
    };
  }

  public async executeTool(
    name: string,
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const tool = this.getTool(name);
    if (!tool) {
      return {
        success: false,
        error: `Tool '${name}' not found in registry`,
      };
    }

    // Run PreToolUse hooks
    try {
      const { hookManager } = await import('../plugins/index.js');
      const hookResult = await hookManager.runPreToolUseHooks(name, input);

      if (!hookResult.allowed) {
        return {
          success: false,
          error: hookResult.message || 'Tool execution blocked by hook',
        };
      }

      // Use modified input if hook provided it
      if (hookResult.modifiedInput) {
        input = hookResult.modifiedInput;
      }
    } catch (error) {
      // Hooks not available or error - continue without hooks
    }

    try {
      const result = await tool.execute(input, context);

      // Run PostToolUse hooks
      try {
        const { hookManager } = await import('../plugins/index.js');
        await hookManager.runPostToolUseHooks(name, result);
      } catch (error) {
        // Hooks not available or error - that's okay
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public shouldConfirmTool(name: string, input: Record<string, unknown>): boolean {
    const tool = this.getTool(name);
    if (!tool || !tool.shouldConfirm) {
      return false;
    }
    return tool.shouldConfirm(input);
  }
}

// Global singleton instance
export const toolRegistry = new ToolRegistry();
