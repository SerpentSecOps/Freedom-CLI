/**
 * Edit Lines tool - Edit file by replacing lines between start and end line numbers
 * Alternative to the exact-match edit tool, more forgiving for models that struggle with exact string matching
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import type { Tool, ToolExecutionContext, ToolExecutionResult } from '../types.js';
import { validatePathNotQuarantined, resolveSafePath } from '../quarantine.js';

export const editLinesTool: Tool = {
  definition: {
    name: 'edit_lines',
    description: 'Edit a file by replacing lines between start_line and end_line (inclusive) with new content. This is an alternative to the "edit" tool that uses line numbers instead of exact string matching - useful when you know the line numbers but struggle with exact text reproduction. Line numbers are 1-indexed (first line is 1). Use the "read" tool first to see line numbers.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to edit',
        },
        start_line: {
          type: 'number',
          description: 'First line number to replace (1-indexed, inclusive)',
        },
        end_line: {
          type: 'number',
          description: 'Last line number to replace (1-indexed, inclusive). Use same as start_line to replace a single line.',
        },
        new_content: {
          type: 'string',
          description: 'New content to insert (replaces lines from start_line to end_line). Can be multiple lines.',
        },
      },
      required: ['path', 'start_line', 'end_line', 'new_content'],
    },
  },

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const inputPath = input.path as string;
    const startLine = input.start_line as number;
    const endLine = input.end_line as number;
    const newContent = input.new_content as string;

    // Validate line numbers
    if (!Number.isInteger(startLine) || startLine < 1) {
      return {
        success: false,
        error: `Invalid start_line: ${startLine}. Must be a positive integer (1-indexed).`,
      };
    }

    if (!Number.isInteger(endLine) || endLine < 1) {
      return {
        success: false,
        error: `Invalid end_line: ${endLine}. Must be a positive integer (1-indexed).`,
      };
    }

    if (endLine < startLine) {
      return {
        success: false,
        error: `end_line (${endLine}) cannot be less than start_line (${startLine}).`,
      };
    }

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
      const lines = content.split('\n');

      // Validate line numbers against file
      if (startLine > lines.length) {
        return {
          success: false,
          error: `start_line (${startLine}) is beyond end of file (${lines.length} lines).`,
        };
      }

      if (endLine > lines.length) {
        return {
          success: false,
          error: `end_line (${endLine}) is beyond end of file (${lines.length} lines).`,
        };
      }

      // Convert to 0-indexed
      const startIdx = startLine - 1;
      const endIdx = endLine - 1;

      // Get the lines being replaced (for output)
      const replacedLines = lines.slice(startIdx, endIdx + 1);
      const linesReplaced = replacedLines.length;

      // Format what's being replaced for the output
      const replacedPreview = replacedLines
        .map((l, idx) => `${startLine + idx}: ${l}`)
        .join('\n');

      // Build new content
      const newLines = newContent.split('\n');
      const resultLines = [
        ...lines.slice(0, startIdx),
        ...newLines,
        ...lines.slice(endIdx + 1),
      ];

      // Write back
      writeFileSync(filePath, resultLines.join('\n'), 'utf-8');

      // Calculate line shift
      const lineShift = newLines.length - linesReplaced;
      const shiftMsg = lineShift !== 0 
        ? `\n\n⚠️  Line numbers below line ${endLine} have shifted by ${lineShift > 0 ? '+' : ''}${lineShift}. Please re-read the file before making further edits.`
        : '';

      // Format what was inserted for the output
      const insertedPreview = newLines
        .map((l, idx) => `${startLine + idx}: ${l}`)
        .join('\n');

      return {
        success: true,
        output: `File edited successfully: ${filePath}\n\nReplaced (${linesReplaced} lines):\n${replacedPreview}\n\nWith (${newLines.length} lines):\n${insertedPreview}${shiftMsg}`,
        metadata: {
          path: filePath,
          startLine,
          endLine,
          linesReplaced,
          linesInserted: newLines.length,
          lineShift,
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
