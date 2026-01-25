/**
 * Hook manager - handles event-driven hooks from plugins
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { Hook, HookEvent, HookResult } from './plugin-types.js';

const execAsync = promisify(exec);

/**
 * Hook manager - registers and executes hooks
 */
export class HookManager {
  private hooks: Map<HookEvent, Hook[]> = new Map();

  /**
   * Register a hook
   */
  registerHook(hook: Hook): void {
    const existing = this.hooks.get(hook.event) || [];
    existing.push(hook);
    this.hooks.set(hook.event, existing);
  }

  /**
   * Unregister all hooks for an event
   */
  unregisterHooks(event: HookEvent): void {
    this.hooks.delete(event);
  }

  /**
   * Get all hooks for an event
   */
  getHooks(event: HookEvent): Hook[] {
    return this.hooks.get(event) || [];
  }

  /**
   * Execute all hooks for an event
   */
  async executeHooks(
    event: HookEvent,
    context: any = {}
  ): Promise<HookResult[]> {
    const hooks = this.getHooks(event);
    const results: HookResult[] = [];

    for (const hook of hooks) {
      try {
        const result = await this.executeHook(hook, context);
        results.push(result);

        // If any hook blocks, stop processing
        if (result.block) {
          break;
        }
      } catch (error: any) {
        results.push({
          hook,
          success: false,
          error: error.message,
          block: false,
        });
      }
    }

    return results;
  }

  /**
   * Execute a single hook
   */
  private async executeHook(hook: Hook, context: any): Promise<HookResult> {
    if (hook.type === 'command') {
      return await this.executeCommandHook(hook, context);
    } else if (hook.type === 'prompt') {
      return await this.executePromptHook(hook, context);
    } else {
      throw new Error(`Unknown hook type: ${hook.type}`);
    }
  }

  /**
   * Execute a command hook (runs a bash script)
   */
  private async executeCommandHook(hook: Hook, context: any): Promise<HookResult> {
    if (!hook.command) {
      return {
        hook,
        success: false,
        error: 'Command hook missing command field',
        block: false,
      };
    }

    try {
      const { stdout, stderr } = await execAsync(hook.command, {
        cwd: hook.cwd || process.cwd(),
        timeout: hook.timeout || 30000, // 30s default timeout
        env: {
          ...process.env,
          // Pass context as environment variables
          HOOK_EVENT: hook.event,
          HOOK_CONTEXT: JSON.stringify(context),
        },
      });

      const output = [stdout, stderr].filter(Boolean).join('\n');

      return {
        hook,
        success: true,
        output,
        block: false,
      };
    } catch (error: any) {
      return {
        hook,
        success: false,
        error: error.message,
        output: error.stdout || error.stderr,
        block: false,
      };
    }
  }

  /**
   * Execute a prompt hook (evaluates with LLM)
   * Note: This requires LLM integration, which we'll implement when needed
   */
  private async executePromptHook(hook: Hook, context: any): Promise<HookResult> {
    // For now, prompt hooks are not fully implemented
    // They would require sending the prompt to the LLM and interpreting the response
    return {
      hook,
      success: true,
      output: 'Prompt hooks not yet fully implemented',
      block: false,
    };
  }

  /**
   * Run PreToolUse hooks - can modify or block tool execution
   */
  async runPreToolUseHooks(
    toolName: string,
    input: any
  ): Promise<{ allowed: boolean; modifiedInput?: any; message?: string }> {
    const results = await this.executeHooks('PreToolUse', {
      toolName,
      input,
    });

    // Check if any hook blocks
    const blockingHook = results.find((r) => r.block);
    if (blockingHook) {
      return {
        allowed: false,
        message: blockingHook.output || 'Tool use blocked by hook',
      };
    }

    // Check if any hook modified the input
    const modifyingHook = results.find((r) => r.modifiedInput);
    if (modifyingHook) {
      return {
        allowed: true,
        modifiedInput: modifyingHook.modifiedInput,
      };
    }

    return { allowed: true };
  }

  /**
   * Run PostToolUse hooks
   */
  async runPostToolUseHooks(toolName: string, result: any): Promise<void> {
    await this.executeHooks('PostToolUse', {
      toolName,
      result,
    });
  }

  /**
   * Run UserPromptSubmit hooks
   */
  async runUserPromptSubmitHooks(userPrompt: string): Promise<{
    allowed: boolean;
    modifiedPrompt?: string;
    message?: string;
  }> {
    const results = await this.executeHooks('UserPromptSubmit', {
      userPrompt,
    });

    // Check if any hook blocks
    const blockingHook = results.find((r) => r.block);
    if (blockingHook) {
      return {
        allowed: false,
        message: blockingHook.output || 'Prompt blocked by hook',
      };
    }

    return { allowed: true };
  }

  /**
   * Run SessionStart hooks
   */
  async runSessionStartHooks(): Promise<void> {
    await this.executeHooks('SessionStart', {});
  }

  /**
   * Run SessionEnd hooks
   */
  async runSessionEndHooks(): Promise<void> {
    await this.executeHooks('SessionEnd', {});
  }

  /**
   * Clear all hooks
   */
  clear(): void {
    this.hooks.clear();
  }

  /**
   * Get statistics
   */
  getStats(): { totalHooks: number; hooksByEvent: Record<string, number> } {
    const hooksByEvent: Record<string, number> = {};
    let totalHooks = 0;

    for (const [event, hooks] of this.hooks.entries()) {
      hooksByEvent[event] = hooks.length;
      totalHooks += hooks.length;
    }

    return { totalHooks, hooksByEvent };
  }
}

/**
 * Global hook manager instance
 */
export const hookManager = new HookManager();
