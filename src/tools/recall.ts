/**
 * Recall tool - Retrieve archived tool output
 */

import type { Tool, ToolExecutionContext, ToolExecutionResult } from '../types.js';
import { ToolHistoryManager } from '../context/tool-history-manager.js';

export const recallTool: Tool = {
  definition: {
    name: 'recall',
    description: 'Retrieve the full content of an archived tool output. Use this when you see a message like "[Output archived... ID: abc12345]" and you need to see the original data again to perform your task.',
    input_schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The 8-character ID of the archived output (e.g., "a1b2c3d4")',
        },
      },
      required: ['id'],
    },
  },

  async execute(input: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const id = input.id as string;
    const content = ToolHistoryManager.retrieveOutput(id);

    if (content === null) {
      return {
        success: false,
        error: `Output with ID "${id}" not found in archive. It may have been lost if the session was restarted.`,
      };
    }

    return {
      success: true,
      output: content,
      metadata: {
        source: 'archive',
        id,
      }
    };
  },
};
