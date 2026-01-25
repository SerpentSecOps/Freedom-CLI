/**
 * Git tools - Version control operations
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { Tool, ToolExecutionContext, ToolExecutionResult } from '../types.js';

const execAsync = promisify(exec);

/**
 * Helper to check if we're in a git repository
 */
async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await execAsync('git rev-parse --git-dir', { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * GitStatus - Show git repository status
 */
export const gitStatusTool: Tool = {
  definition: {
    name: 'git_status',
    description: 'Get the current git repository status, including staged/unstaged changes, untracked files, and current branch.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  async execute(_input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    try {
      if (!(await isGitRepo(context.workingDirectory))) {
        return {
          success: false,
          error: 'Not a git repository',
        };
      }

      const { stdout } = await execAsync('git status', {
        cwd: context.workingDirectory,
        env: process.env,
      });

      return {
        success: true,
        output: stdout.trim(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        output: error.stdout || error.stderr,
      };
    }
  },

  shouldConfirm(): boolean {
    return false; // Read-only operation
  },
};

/**
 * GitDiff - Show git diff
 */
export const gitDiffTool: Tool = {
  definition: {
    name: 'git_diff',
    description: 'Show git diff for staged or unstaged changes. Useful for understanding what will be committed.',
    input_schema: {
      type: 'object',
      properties: {
        staged: {
          type: 'boolean',
          description: 'Show diff for staged changes (--cached). Default: false (shows unstaged changes)',
        },
        file_path: {
          type: 'string',
          description: 'Optional file path to show diff for a specific file',
        },
      },
      required: [],
    },
  },

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    try {
      if (!(await isGitRepo(context.workingDirectory))) {
        return {
          success: false,
          error: 'Not a git repository',
        };
      }

      const staged = input.staged as boolean || false;
      const filePath = input.file_path as string | undefined;

      let command = 'git diff';
      if (staged) {
        command += ' --cached';
      }
      if (filePath) {
        command += ` -- ${filePath}`;
      }

      const { stdout } = await execAsync(command, {
        cwd: context.workingDirectory,
        env: process.env,
        maxBuffer: 1024 * 1024 * 10, // 10MB
      });

      return {
        success: true,
        output: stdout || 'No changes',
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        output: error.stdout || error.stderr,
      };
    }
  },

  shouldConfirm(): boolean {
    return false; // Read-only operation
  },
};

/**
 * GitLog - Show git commit history
 */
export const gitLogTool: Tool = {
  definition: {
    name: 'git_log',
    description: 'Show recent git commit history. Useful for understanding recent changes and commit message patterns.',
    input_schema: {
      type: 'object',
      properties: {
        max_count: {
          type: 'number',
          description: 'Maximum number of commits to show (default: 10)',
        },
        oneline: {
          type: 'boolean',
          description: 'Show one line per commit (default: true)',
        },
      },
      required: [],
    },
  },

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    try {
      if (!(await isGitRepo(context.workingDirectory))) {
        return {
          success: false,
          error: 'Not a git repository',
        };
      }

      const maxCount = (input.max_count as number) || 10;
      const oneline = input.oneline !== false; // Default true

      let command = `git log -n ${maxCount}`;
      if (oneline) {
        command += ' --oneline';
      }

      const { stdout } = await execAsync(command, {
        cwd: context.workingDirectory,
        env: process.env,
      });

      return {
        success: true,
        output: stdout.trim() || 'No commits',
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        output: error.stdout || error.stderr,
      };
    }
  },

  shouldConfirm(): boolean {
    return false; // Read-only operation
  },
};

/**
 * GitAdd - Stage files for commit
 */
export const gitAddTool: Tool = {
  definition: {
    name: 'git_add',
    description: 'Stage files for commit. Can add specific files or all changes.',
    input_schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          description: 'Array of file paths to stage. Use ["."] to stage all changes.',
          items: {
            type: 'string',
            description: 'File path to stage',
          },
        },
      },
      required: ['files'],
    },
  },

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    try {
      if (!(await isGitRepo(context.workingDirectory))) {
        return {
          success: false,
          error: 'Not a git repository',
        };
      }

      const files = input.files as string[];
      if (!files || files.length === 0) {
        return {
          success: false,
          error: 'No files specified',
        };
      }

      const fileArgs = files.join(' ');
      const { stdout, stderr } = await execAsync(`git add ${fileArgs}`, {
        cwd: context.workingDirectory,
        env: process.env,
      });

      return {
        success: true,
        output: stdout || stderr || `Staged files: ${fileArgs}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        output: error.stdout || error.stderr,
      };
    }
  },

  shouldConfirm(input: Record<string, unknown>): boolean {
    // Confirm if staging everything
    const files = input.files as string[];
    return files.includes('.') || files.includes('-A') || files.includes('--all');
  },
};

/**
 * GitCommit - Create a commit
 */
export const gitCommitTool: Tool = {
  definition: {
    name: 'git_commit',
    description: 'Create a git commit with the staged changes. Always stage files with git_add before committing.',
    input_schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The commit message. Should be clear and descriptive.',
        },
        amend: {
          type: 'boolean',
          description: 'Amend the previous commit instead of creating a new one. Use with caution.',
        },
      },
      required: ['message'],
    },
  },

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    try {
      if (!(await isGitRepo(context.workingDirectory))) {
        return {
          success: false,
          error: 'Not a git repository',
        };
      }

      const message = input.message as string;
      const amend = input.amend as boolean || false;

      if (!message || message.trim().length === 0) {
        return {
          success: false,
          error: 'Commit message cannot be empty',
        };
      }

      let command = `git commit -m "${message.replace(/"/g, '\\"')}"`;
      if (amend) {
        command = `git commit --amend -m "${message.replace(/"/g, '\\"')}"`;
      }

      const { stdout, stderr } = await execAsync(command, {
        cwd: context.workingDirectory,
        env: process.env,
      });

      return {
        success: true,
        output: stdout || stderr,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        output: error.stdout || error.stderr,
      };
    }
  },

  shouldConfirm(input: Record<string, unknown>): boolean {
    // Always confirm commits
    return true;
  },
};

/**
 * GitPush - Push commits to remote
 */
export const gitPushTool: Tool = {
  definition: {
    name: 'git_push',
    description: 'Push commits to the remote repository. Use with caution as this affects the remote.',
    input_schema: {
      type: 'object',
      properties: {
        remote: {
          type: 'string',
          description: 'Remote name (default: origin)',
        },
        branch: {
          type: 'string',
          description: 'Branch name. If not specified, pushes current branch.',
        },
        force: {
          type: 'boolean',
          description: 'Force push. DANGEROUS - only use if you know what you are doing.',
        },
        set_upstream: {
          type: 'boolean',
          description: 'Set upstream for the current branch (-u flag)',
        },
      },
      required: [],
    },
  },

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    try {
      if (!(await isGitRepo(context.workingDirectory))) {
        return {
          success: false,
          error: 'Not a git repository',
        };
      }

      const remote = (input.remote as string) || 'origin';
      const branch = input.branch as string | undefined;
      const force = input.force as boolean || false;
      const setUpstream = input.set_upstream as boolean || false;

      let command = `git push ${remote}`;
      if (branch) {
        command += ` ${branch}`;
      }
      if (force) {
        command += ' --force';
      }
      if (setUpstream) {
        command += ' -u';
      }

      const { stdout, stderr } = await execAsync(command, {
        cwd: context.workingDirectory,
        env: process.env,
        timeout: 60000, // 60 seconds for network operations
      });

      return {
        success: true,
        output: stdout || stderr,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        output: error.stdout || error.stderr,
      };
    }
  },

  shouldConfirm(input: Record<string, unknown>): boolean {
    // Always confirm pushes, especially force pushes
    return true;
  },
};

/**
 * GitBranch - List or create branches
 */
export const gitBranchTool: Tool = {
  definition: {
    name: 'git_branch',
    description: 'List branches or get current branch name. For creating/switching branches, use git_checkout.',
    input_schema: {
      type: 'object',
      properties: {
        list_all: {
          type: 'boolean',
          description: 'List all branches including remotes (default: false)',
        },
      },
      required: [],
    },
  },

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    try {
      if (!(await isGitRepo(context.workingDirectory))) {
        return {
          success: false,
          error: 'Not a git repository',
        };
      }

      const listAll = input.list_all as boolean || false;
      const command = listAll ? 'git branch -a' : 'git branch';

      const { stdout } = await execAsync(command, {
        cwd: context.workingDirectory,
        env: process.env,
      });

      return {
        success: true,
        output: stdout.trim(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        output: error.stdout || error.stderr,
      };
    }
  },

  shouldConfirm(): boolean {
    return false; // Read-only operation
  },
};

/**
 * GitCheckout - Switch branches or create new branch
 */
export const gitCheckoutTool: Tool = {
  definition: {
    name: 'git_checkout',
    description: 'Switch to an existing branch or create a new branch.',
    input_schema: {
      type: 'object',
      properties: {
        branch: {
          type: 'string',
          description: 'Branch name to checkout or create',
        },
        create_new: {
          type: 'boolean',
          description: 'Create a new branch (-b flag). Default: false',
        },
      },
      required: ['branch'],
    },
  },

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    try {
      if (!(await isGitRepo(context.workingDirectory))) {
        return {
          success: false,
          error: 'Not a git repository',
        };
      }

      const branch = input.branch as string;
      const createNew = input.create_new as boolean || false;

      if (!branch || branch.trim().length === 0) {
        return {
          success: false,
          error: 'Branch name cannot be empty',
        };
      }

      const command = createNew ? `git checkout -b ${branch}` : `git checkout ${branch}`;

      const { stdout, stderr } = await execAsync(command, {
        cwd: context.workingDirectory,
        env: process.env,
      });

      return {
        success: true,
        output: stdout || stderr,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        output: error.stdout || error.stderr,
      };
    }
  },

  shouldConfirm(input: Record<string, unknown>): boolean {
    // Confirm when creating new branches
    return !!(input.create_new as boolean);
  },
};
