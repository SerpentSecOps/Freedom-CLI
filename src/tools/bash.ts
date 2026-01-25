/**
 * Bash tool - Execute shell commands
 * Supports local, remote (SSH), and interactive (PTY) execution
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { Tool, ToolExecutionContext, ToolExecutionResult } from '../types.js';
import { backgroundManager } from '../background-manager.js';
import { sshManager } from '../ssh-manager.js';
import { terminalManager } from '../terminal-manager.js';

const execAsync = promisify(exec);

// Helper to wait for a specified duration
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const bashTool: Tool = {
  definition: {
    name: 'bash',
    description: `Execute a bash command in the shell. Supports multiple modes:

**Standard mode** (default): Execute command and return output.
**Interactive mode** (mode="async"): Start a PTY session for interactive commands (sudo, npm init, installers with menus). Returns a sessionId for subsequent interactions.

For interactive sessions, use these parameter combinations:
- Start session: command + mode="async" → returns sessionId
- Send input: sessionId + input (supports {enter}, {up}, {down}, {left}, {right}, {backspace}, {tab}, {ctrl+c})
- Read output: sessionId + delay (seconds to wait before reading)
- Stop session: sessionId + stop=true

Examples:
- Start: { "command": "npm init", "mode": "async" }
- Send input: { "sessionId": "term-123", "input": "my-package{enter}" }
- Navigate menu: { "sessionId": "term-123", "input": "{down}{down}{enter}" }
- Read output: { "sessionId": "term-123", "delay": 2 }
- Stop: { "sessionId": "term-123", "stop": true }`,
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The bash command to execute (required for starting new commands)',
        },
        description: {
          type: 'string',
          description: 'Clear, concise description of what this command does in 5-10 words',
        },
        timeout: {
          type: 'number',
          description: 'Optional timeout in milliseconds (max 600000, default: 120000)',
        },
        run_in_background: {
          type: 'boolean',
          description: 'Set to true to run non-interactively in background. Use task_output tool to retrieve results.',
        },
        mode: {
          type: 'string',
          enum: ['sync', 'async'],
          description: 'Execution mode. "sync" (default) runs and waits. "async" starts interactive PTY session.',
        },
        sessionId: {
          type: 'string',
          description: 'Session ID for interacting with an existing async session',
        },
        input: {
          type: 'string',
          description: 'Input to send to async session. Supports special keys: {enter}, {up}, {down}, {left}, {right}, {backspace}, {tab}, {escape}, {ctrl+c}',
        },
        delay: {
          type: 'number',
          description: 'Seconds to wait before reading output from async session (default: 1)',
        },
        stop: {
          type: 'boolean',
          description: 'Set to true with sessionId to stop an async session',
        },
      },
      required: [],
    },
  },

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const command = input.command as string | undefined;
    const description = input.description as string | undefined;
    const timeout = Math.min((input.timeout as number) || 120000, 600000);
    const runInBackground = input.run_in_background as boolean;
    const mode = (input.mode as string) || 'sync';
    const sessionId = input.sessionId as string | undefined;
    const inputText = input.input as string | undefined;
    const delay = (input.delay as number) ?? 1;
    const stop = input.stop as boolean;

    // ═══════════════════════════════════════════════════════════════════════════
    // Interactive Session Operations (when sessionId is provided)
    // ═══════════════════════════════════════════════════════════════════════════
    
    if (sessionId) {
      // Stop session
      if (stop) {
        const stopped = terminalManager.stopSession(sessionId);
        if (stopped) {
          return {
            success: true,
            output: `Session ${sessionId} stopped.`,
          };
        } else {
          return {
            success: false,
            error: `Session ${sessionId} not found or already stopped.`,
          };
        }
      }

      // Write input to session
      if (inputText !== undefined) {
        const written = terminalManager.writeToSession(sessionId, inputText);
        if (!written) {
          return {
            success: false,
            error: `Session ${sessionId} not found or not running. It may have exited.`,
          };
        }

        // Wait for the specified delay then read output
        await sleep(delay * 1000);
        
        const result = terminalManager.readFromSession(sessionId);
        if (!result) {
          return {
            success: false,
            error: `Failed to read from session ${sessionId}.`,
          };
        }

        const statusMsg = result.isRunning 
          ? 'Session is still running. Use read_bash or send more input.'
          : 'Session has exited.';

        return {
          success: true,
          output: result.output || '(no output)',
          metadata: {
            sessionId,
            isRunning: result.isRunning,
            hint: statusMsg,
          },
        };
      }

      // Read from session (no input provided, just delay)
      if (delay !== undefined) {
        await sleep(delay * 1000);
        
        const result = terminalManager.readFromSession(sessionId);
        if (!result) {
          return {
            success: false,
            error: `Session ${sessionId} not found.`,
          };
        }

        const statusMsg = result.isRunning 
          ? 'Session is still running.'
          : 'Session has exited.';

        return {
          success: true,
          output: result.output || '(no output yet)',
          metadata: {
            sessionId,
            isRunning: result.isRunning,
            hint: statusMsg,
          },
        };
      }

      // Just sessionId with nothing else - return session info
      const info = terminalManager.getSessionInfo(sessionId);
      if (!info) {
        return {
          success: false,
          error: `Session ${sessionId} not found.`,
        };
      }

      return {
        success: true,
        output: `Session ${sessionId}:\n  Command: ${info.command}\n  Running: ${info.isRunning}\n  Uptime: ${Math.round(info.uptime / 1000)}s`,
        metadata: info,
      };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Start New Session/Command
    // ═══════════════════════════════════════════════════════════════════════════

    if (!command) {
      return {
        success: false,
        error: 'Either "command" (to start a new command) or "sessionId" (to interact with existing session) is required.',
      };
    }

    // Build execution message
    let executionMessage = `Executing: ${command}`;
    if (description) {
      executionMessage = `${description}\nCommand: ${command}`;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Async/Interactive Mode - Start PTY Session
    // ─────────────────────────────────────────────────────────────────────────
    
    if (mode === 'async') {
      try {
        const newSessionId = terminalManager.startSession({
          command,
          cwd: context.workingDirectory,
          env: context.environment,
        });

        // Wait a moment for initial output
        await sleep(500);
        
        const initialOutput = terminalManager.readFromSession(newSessionId);
        
        return {
          success: true,
          output: `${executionMessage}\n\nStarted interactive session: ${newSessionId}\n\n${initialOutput?.output || '(waiting for output...)'}`,
          metadata: {
            sessionId: newSessionId,
            isRunning: initialOutput?.isRunning ?? true,
            hint: 'Use sessionId with "input" to send keystrokes, or "delay" to read more output.',
          },
        };
      } catch (error: any) {
        return {
          success: false,
          error: `Failed to start interactive session: ${error.message}`,
        };
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Remote SSH execution
    // ─────────────────────────────────────────────────────────────────────────
    if (context.executionMode === 'remote' && sshManager.isConnected()) {
      if (runInBackground) {
        return {
          success: false,
          error: 'Background execution is not yet supported in remote mode. Run command normally instead.',
        };
      }

      try {
        const result = await sshManager.executeCommand(command, {
          cwd: context.workingDirectory,
          env: context.environment,
          timeout,
        });

        const output = [result.stdout, result.stderr].filter(Boolean).join('\n---STDERR---\n');

        if (result.exitCode === 0) {
          return {
            success: true,
            output: `${executionMessage} (remote)\n\n${output || 'Command completed successfully'}`,
            metadata: {
              remote: true,
              exitCode: result.exitCode,
              duration: result.duration,
            },
          };
        } else {
          return {
            success: false,
            error: `Command exited with code ${result.exitCode}`,
            output: `${executionMessage} (remote)\n\n${output}`,
            metadata: {
              remote: true,
              exitCode: result.exitCode,
              duration: result.duration,
            },
          };
        }
      } catch (error: any) {
        return {
          success: false,
          error: `Remote command execution failed: ${error.message}`,
        };
      }
    }

    // Local execution (original behavior)
    // In sandboxed mode, check for directory escape attempts
    if (context.sandboxed) {
      const blockReason = this.shouldBlock?.(input, context);
      if (blockReason) {
        return {
          success: false,
          error: blockReason,
          metadata: { errorType: 'PERMISSION_DENIED' },
        };
      }
    }

    // Handle background execution
    if (runInBackground) {
      const taskId = backgroundManager.startBashTask(
        command,
        context.workingDirectory,
        context.environment,
        timeout
      );

      return {
        success: true,
        output: `${executionMessage}\n\nStarted in background with task ID: ${taskId}\nUse task_output tool with task_id="${taskId}" to check status and retrieve results.`,
      };
    }

    // Normal (foreground) execution
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: context.workingDirectory,
        env: { ...process.env, ...context.environment },
        timeout,
        maxBuffer: 1024 * 1024 * 10, // 10MB
      });

      const output = [stdout, stderr].filter(Boolean).join('\n---STDERR---\n');

      return {
        success: true,
        output: `${executionMessage}\n\n${output || 'Command completed successfully'}`,
      };
    } catch (error: any) {
      // Provide better error messages for timeouts
      let errorMessage = error.message;
      if (error.killed && error.signal === 'SIGTERM') {
        errorMessage = `Command timed out after ${timeout}ms. Consider increasing the timeout parameter or optimizing the command.`;
      }

      return {
        success: false,
        error: errorMessage,
        output: `${executionMessage}\n\n${error.stdout || error.stderr || ''}`,
      };
    }
  },

  shouldConfirm(input: Record<string, unknown>): boolean {
    const command = input.command as string;
    const dangerousPatterns = [
      /rm\s+-rf/,
      /dd\s+if=/,
      /mkfs/,
      /:\(\)\{.*\};\s*:/,  // Fork bomb
      /chmod\s+-R\s+777/,
      /chown\s+-R/,
    ];
    return dangerousPatterns.some(pattern => pattern.test(command));
  },

  // Block commands that try to escape the working directory
  shouldBlock(input: Record<string, unknown>, context: ToolExecutionContext): string | null {
    const command = input.command as string;

    // Block dangerous system directories (absolute paths to sensitive locations)
    // These are paths that should never be accessed by an AI in sandbox mode
    const dangerousPathPatterns = [
      /(?:^|\s)\/etc(?:\/|$|\s)/,          // /etc and subdirs
      /(?:^|\s)\/usr(?:\/|$|\s)/,          // /usr and subdirs
      /(?:^|\s)\/bin(?:\/|$|\s)/,          // /bin
      /(?:^|\s)\/sbin(?:\/|$|\s)/,         // /sbin
      /(?:^|\s)\/boot(?:\/|$|\s)/,         // /boot
      /(?:^|\s)\/root(?:\/|$|\s)/,         // /root
      /(?:^|\s)\/var(?:\/|$|\s)/,          // /var
      /(?:^|\s)\/lib(?:\/|$|\s)/,          // /lib
      /(?:^|\s)\/opt(?:\/|$|\s)/,          // /opt
      /(?:^|\s)\/sys(?:\/|$|\s)/,          // /sys
      /(?:^|\s)\/run(?:\/|$|\s)/,          // /run
      /(?:^|\s)~\//,                        // Home directory via ~
      /(?:^|\s)\/home\/(?!.*\/\.\/).*(?:\/|$|\s)/, // Other users' home dirs (but not working dir)
    ];

    for (const pattern of dangerousPathPatterns) {
      if (pattern.test(command)) {
        const match = command.match(pattern);
        return `Access denied: Cannot access system path "${match?.[0]?.trim() || 'system directory'}". Use relative paths within the project.`;
      }
    }

    // Block directory escape attempts
    const escapePatterns = [
      /cd\s+\.\./,           // cd ..
      /cd\s+\/(?!tmp)/,      // cd /absolute (except /tmp)
      /\.\.\//,              // ../anything
    ];

    for (const pattern of escapePatterns) {
      if (pattern.test(command)) {
        return `Access denied: Commands that navigate outside the working directory are not allowed.`;
      }
    }

    return null; // No block
  },
};
