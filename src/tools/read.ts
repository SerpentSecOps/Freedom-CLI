/**
 * Read tool - Read file contents
 * Supports both local and remote (SSH) execution
 */

import { readFileSync, statSync } from 'fs';
import { resolve } from 'path';
import type { Tool, ToolExecutionContext, ToolExecutionResult } from '../types.js';
import { validatePathNotQuarantined, resolveSafePath } from '../quarantine.js';
import { sshManager } from '../ssh-manager.js';

export const readTool: Tool = {
  definition: {
    name: 'read',
    description: 'Read the contents of a file. Use this to examine source code, configuration files, documentation, or any text-based file. Always use this tool when the user asks about file contents or when you need to understand existing code before making changes. Returns file content with line numbers.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to read (absolute or relative to working directory)',
        },
        offset: {
          type: 'number',
          description: 'Line number to start reading from (0-indexed)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of lines to read',
        },
      },
      required: ['path'],
    },
  },

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const inputPath = input.path as string;
    const offset = (input.offset as number) || 0;
    const limit = input.limit as number | undefined;

    // Remote SSH execution
    if (context.executionMode === 'remote' && sshManager.isConnected()) {
      try {
        // Use absolute path if provided, otherwise resolve relative to remote working directory
        const remotePath = inputPath.startsWith('/')
          ? inputPath
          : `${context.workingDirectory}/${inputPath}`;

        // Read file via SSH
        const buffer = await sshManager.readFile(remotePath);
        const content = buffer.toString('utf-8');
        const lines = content.split('\n');

        // Apply offset and limit
        const startLine = offset;
        const endLine = limit ? startLine + limit : lines.length;
        const selectedLines = lines.slice(startLine, endLine);

        // Format with line numbers
        const output = selectedLines
          .map((line, idx) => `${startLine + idx + 1}: ${line}`)
          .join('\n');

        return {
          success: true,
          output,
          metadata: {
            totalLines: lines.length,
            linesRead: selectedLines.length,
            path: remotePath,
            remote: true,
          },
        };
      } catch (error: any) {
        return {
          success: false,
          error: `Remote read failed: ${error.message}`,
        };
      }
    }

    // Local execution (original behavior)
    let filePath: string;
    try {
      // In sandboxed mode (CL), enforce containment to working directory
      if (context.sandboxed) {
        filePath = resolveSafePath(inputPath, context.workingDirectory);
      } else {
        // In supervised mode, allow any path (just resolve it)
        filePath = resolve(context.workingDirectory, inputPath);
      }
      // Always check if path is quarantined
      validatePathNotQuarantined(filePath);
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }

    try {
      // Check if file exists and is a file
      const stats = statSync(filePath);
      if (!stats.isFile()) {
        return {
          success: false,
          error: `Path is not a file: ${filePath}. This is a directory. Suggestion: Use glob({"pattern": "*"}) to list files in this directory, or provide a file path instead.`,
        };
      }

      // Read file
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      // Apply offset and limit
      const startLine = offset;
      const endLine = limit ? startLine + limit : lines.length;
      const selectedLines = lines.slice(startLine, endLine);

      // Format with line numbers
      const output = selectedLines
        .map((line, idx) => `${startLine + idx + 1}: ${line}`)
        .join('\n');

      return {
        success: true,
        output,
        metadata: {
          totalLines: lines.length,
          linesRead: selectedLines.length,
          path: filePath,
        },
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return {
          success: false,
          error: `File not found: ${filePath}. Suggestion: Use glob({"pattern": "**/${inputPath}"}) to find the file, or check if the path is correct.`,
        };
      }
      return {
        success: false,
        error: `Failed to read file: ${error.message}`,
      };
    }
  },
};
