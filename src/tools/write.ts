/**
 * Write tool - Write content to a file
 * Supports both local and remote (SSH) execution
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import type { Tool, ToolExecutionContext, ToolExecutionResult } from '../types.js';
import { validatePathNotQuarantined, resolveSafePath } from '../quarantine.js';
import { convertSystemError, getErrorMessage, getErrorType } from '../errors.js';
import { sshManager } from '../ssh-manager.js';

export const writeTool: Tool = {
  definition: {
    name: 'write',
    description: 'Write content to a file. Creates the file if it doesn\'t exist, overwrites if it does. Use this when creating new files or completely replacing file contents. For making small changes to existing files, use the edit tool instead. The file\'s parent directory will be created automatically if needed.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to write (absolute or relative to working directory)',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
  },

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const inputPath = input.path as string;
    const content = input.content as string;

    // Remote SSH execution
    if (context.executionMode === 'remote' && sshManager.isConnected()) {
      try {
        // Use absolute path if provided, otherwise resolve relative to remote working directory
        const remotePath = inputPath.startsWith('/')
          ? inputPath
          : `${context.workingDirectory}/${inputPath}`;

        // Ensure parent directory exists on remote
        const remoteDir = remotePath.substring(0, remotePath.lastIndexOf('/'));
        if (remoteDir) {
          await sshManager.executeCommand(`mkdir -p ${remoteDir}`);
        }

        // Write file via SSH
        await sshManager.writeFile(remotePath, content);

        return {
          success: true,
          output: `File written successfully (remote): ${remotePath}`,
          metadata: {
            path: remotePath,
            bytes: Buffer.byteLength(content, 'utf-8'),
            remote: true,
          },
        };
      } catch (error: any) {
        return {
          success: false,
          error: `Remote write failed: ${error.message}`,
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
        metadata: { errorType: 'PERMISSION_DENIED' },
      };
    }

    try {
      // Ensure parent directory exists
      const dir = dirname(filePath);
      mkdirSync(dir, { recursive: true });

      // Write file
      writeFileSync(filePath, content, 'utf-8');

      return {
        success: true,
        output: `File written successfully: ${filePath}`,
        metadata: {
          path: filePath,
          bytes: Buffer.byteLength(content, 'utf-8'),
        },
      };
    } catch (error: any) {
      // Convert system errors to custom error types
      const convertedError = convertSystemError(error, 'Write file');

      return {
        success: false,
        error: getErrorMessage(convertedError),
        metadata: {
          errorType: getErrorType(convertedError),
        },
      };
    }
  },

  shouldConfirm(input: Record<string, unknown>): boolean {
    const path = input.path as string;
    // Confirm for system files or sensitive locations
    const sensitivePatterns = [
      /^\/etc\//,
      /^\/usr\//,
      /^\/bin\//,
      /^\/sbin\//,
      /\.ssh\//,
      /\.env$/,
    ];
    return sensitivePatterns.some(pattern => pattern.test(path));
  },
};
