/**
 * Task Output tool - Retrieve output from background tasks
 */

import type { Tool, ToolExecutionContext, ToolExecutionResult } from '../types.js';
import { backgroundManager } from '../background-manager.js';

export const taskOutputTool: Tool = {
  definition: {
    name: 'task_output',
    description: 'Retrieves output from a running or completed background task (bash command or agent). Use this to check the status and get results from tasks started with run_in_background=true.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'The task ID returned when the background task was started (e.g., "bash_1", "agent_2")',
        },
        block: {
          type: 'boolean',
          description: 'Whether to wait for the task to complete. If true (default), blocks until task finishes or timeout is reached. If false, returns current status immediately.',
        },
        timeout: {
          type: 'number',
          description: 'Maximum time to wait in milliseconds when blocking (default: 30000, max: 600000)',
        },
      },
      required: ['task_id'],
    },
  },

  async execute(input: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const taskId = input.task_id as string;
    const block = input.block !== false; // Default to true
    const timeout = Math.min((input.timeout as number) || 30000, 600000);

    const task = backgroundManager.getTask(taskId, block, timeout);

    if (!task) {
      return {
        success: false,
        error: `Task not found: ${taskId}. Use the exact task ID returned when the background task was started.`,
      };
    }

    // Format output based on status
    let output = `Task ID: ${task.id}\n`;
    output += `Type: ${task.type}\n`;
    output += `Status: ${task.status}\n`;

    const duration = (task.endTime || Date.now()) - task.startTime;
    output += `Duration: ${(duration / 1000).toFixed(1)}s\n\n`;

    if (task.status === 'running') {
      output += '--- Output so far ---\n';
      output += task.output || '(no output yet)';
      if (block) {
        output += '\n\n(Task still running after timeout. Check again later or increase timeout parameter.)';
      }
    } else if (task.status === 'completed') {
      output += '--- Output ---\n';
      output += task.output || '(no output)';
    } else if (task.status === 'failed') {
      output += `Error: ${task.error}\n\n`;
      if (task.output) {
        output += '--- Output before failure ---\n';
        output += task.output;
      }
    }

    return {
      success: task.status !== 'failed',
      output,
      error: task.status === 'failed' ? task.error : undefined,
    };
  },

  shouldConfirm(): boolean {
    return false; // Reading task output is always safe
  },
};
