/**
 * Edit tool - Edit file by replacing old string with new string
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import type { Tool, ToolExecutionContext, ToolExecutionResult } from '../types.js';
import { validatePathNotQuarantined, resolveSafePath } from '../quarantine.js';

export const editTool: Tool = {
  definition: {
    name: 'edit',
    description: 'Edit a file by replacing an exact string match. Use this to make surgical changes to existing files. The old_string must match exactly (including whitespace and line breaks). If the string appears multiple times, the tool will error - use a larger context string to make it unique. Always read the file first to ensure your old_string is exact.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to edit',
        },
        old_string: {
          type: 'string',
          description: 'Exact string to find and replace',
        },
        new_string: {
          type: 'string',
          description: 'String to replace with',
        },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const inputPath = input.path as string;
    const oldString = input.old_string as string;
    const newString = input.new_string as string;

    // Resolve path - in sandboxed mode (CL), enforce containment
    let filePath: string;
    try {
      if (context.sandboxed) {
        filePath = resolveSafePath(inputPath, context.workingDirectory);
      } else {
        filePath = resolve(context.workingDirectory, inputPath);
      }
      validatePathNotQuarantined(filePath);
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }

    try {
      // Read file
      const content = readFileSync(filePath, 'utf-8');

      // Check if old_string exists
      if (!content.includes(oldString)) {
        // Find the best matching section to help the AI understand what went wrong
        const lines = content.split('\n');
        const oldLines = oldString.split('\n');
        const firstOldLine = oldLines[0].trim();

        // Try to find a line that starts similarly
        let bestMatch = '';
        let bestMatchLine = -1;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(firstOldLine.slice(0, 20)) ||
              firstOldLine.includes(lines[i].trim().slice(0, 20))) {
            bestMatchLine = i + 1;
            // Show context: 2 lines before and after
            const start = Math.max(0, i - 2);
            const end = Math.min(lines.length, i + oldLines.length + 2);
            bestMatch = lines.slice(start, end)
              .map((l, idx) => `${start + idx + 1}: ${l}`)
              .join('\n');
            break;
          }
        }

        let errorMsg = `String not found in file. The old_string must match EXACTLY (including whitespace, indentation, and line breaks).`;

        if (bestMatch) {
          errorMsg += `\n\nDid you mean this section? (lines ${bestMatchLine}+):\n${bestMatch}`;
        } else {
          // Show first 20 lines of file so AI can see actual content
          const preview = lines.slice(0, 20)
            .map((l, idx) => `${idx + 1}: ${l}`)
            .join('\n');
          errorMsg += `\n\nFile preview (first 20 lines):\n${preview}`;
          if (lines.length > 20) {
            errorMsg += `\n... (${lines.length - 20} more lines)`;
          }
        }

        errorMsg += `\n\nTip: Use the edit_lines tool instead if you know the line numbers - it doesn't require exact string matching.`;

        return {
          success: false,
          error: errorMsg,
        };
      }

      // Count occurrences
      const occurrences = content.split(oldString).length - 1;
      if (occurrences > 1) {
        return {
          success: false,
          error: `String appears ${occurrences} times in the file. The edit tool requires a unique match for safety. Suggestion: Include more surrounding context in old_text to make it unique (e.g., include the line above and below).`,
        };
      }

      // Replace
      const newContent = content.replace(oldString, newString);

      // Write back
      writeFileSync(filePath, newContent, 'utf-8');

      return {
        success: true,
        output: `File edited successfully: ${filePath}`,
        metadata: {
          path: filePath,
          occurrences,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to edit file: ${error.message}`,
      };
    }
  },
};
