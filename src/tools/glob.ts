/**
 * Glob tool - Find files matching patterns
 */

import fg from 'fast-glob';
import { resolve } from 'path';
import type { Tool, ToolExecutionContext, ToolExecutionResult } from '../types.js';
import { isPathQuarantined, isPathContained } from '../quarantine.js';

export const globTool: Tool = {
  definition: {
    name: 'glob',
    description: 'Find files matching glob patterns. Use this to discover files in a project, list all files of a certain type, or explore directory structure. Examples: "**/*.ts" (all TypeScript files), "src/**/*.js" (JavaScript in src), "*.json" (JSON files in current dir). Much faster and more reliable than using bash ls or find commands.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern to match files',
        },
        cwd: {
          type: 'string',
          description: 'Directory to search in. Omit this parameter to search in the current working directory.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return',
        },
      },
      required: ['pattern'],
    },
  },

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const pattern = input.pattern as string;
    const inputCwd = input.cwd as string | undefined;
    const limit = input.limit as number | undefined;

    // Determine cwd based on sandbox mode
    let cwd: string;
    if (context.sandboxed) {
      // In sandboxed mode, strip leading slashes and verify containment
      const safeCwd = inputCwd ? inputCwd.replace(/^\/+/, '') : '';
      cwd = safeCwd ? resolve(context.workingDirectory, safeCwd) : context.workingDirectory;

      if (!isPathContained(cwd, context.workingDirectory)) {
        return {
          success: false,
          error: `Access denied: Path "${cwd}" is outside the working directory "${context.workingDirectory}"`,
        };
      }
    } else {
      // In supervised mode, allow any path
      cwd = inputCwd ? resolve(context.workingDirectory, inputCwd) : context.workingDirectory;
    }

    try {
      const files = await fg(pattern, {
        cwd,
        dot: true,
        ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**'],
      });

      // Filter out quarantined paths (and paths outside working directory in sandboxed mode)
      const filteredFiles = files.filter(file => {
        const fullPath = resolve(cwd, file);
        if (isPathQuarantined(fullPath)) return false;
        if (context.sandboxed && !isPathContained(fullPath, context.workingDirectory)) return false;
        return true;
      });

      const results = limit ? filteredFiles.slice(0, limit) : filteredFiles;

      return {
        success: true,
        output: results.length > 0 ? results.join('\n') : 'No files found',
        metadata: {
          totalFiles: files.length,
          filteredFiles: filteredFiles.length,
          returnedFiles: results.length,
          pattern,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Glob search failed: ${error.message}`,
      };
    }
  },
};
