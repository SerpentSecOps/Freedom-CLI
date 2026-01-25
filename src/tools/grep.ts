/**
 * Grep tool - Search for patterns in file contents
 * Inspired by Gemini CLI's grep implementation with multiple strategies
 */

import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { resolve, relative, basename } from 'path';
import fg from 'fast-glob';
import type { Tool, ToolExecutionContext, ToolExecutionResult } from '../types.js';
import { isPathQuarantined, isPathContained } from '../quarantine.js';

interface GrepMatch {
  filePath: string;
  lineNumber: number;
  line: string;
}

/**
 * Parse grep output format: filePath:lineNumber:lineContent
 */
function parseGrepOutput(output: string, basePath: string): GrepMatch[] {
  const results: GrepMatch[] = [];
  if (!output) return results;

  const lines = output.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    // Find first and second colon to handle paths with colons
    const firstColonIndex = line.indexOf(':');
    if (firstColonIndex === -1) continue;

    const secondColonIndex = line.indexOf(':', firstColonIndex + 1);
    if (secondColonIndex === -1) continue;

    const filePathRaw = line.substring(0, firstColonIndex);
    const lineNumberStr = line.substring(firstColonIndex + 1, secondColonIndex);
    const lineContent = line.substring(secondColonIndex + 1);

    const lineNumber = parseInt(lineNumberStr, 10);

    if (!isNaN(lineNumber)) {
      const absoluteFilePath = resolve(basePath, filePathRaw);

      // Skip quarantined paths
      if (isPathQuarantined(absoluteFilePath)) {
        continue;
      }

      const relativeFilePath = relative(basePath, absoluteFilePath);

      results.push({
        filePath: relativeFilePath || basename(absoluteFilePath),
        lineNumber,
        line: lineContent,
      });
    }
  }

  return results;
}

/**
 * Check if a command is available on the system (sync version)
 */
function isCommandAvailableSync(command: string): boolean {
  try {
    const { execSync } = require('child_process');
    const checkCommand = process.platform === 'win32' ? `where ${command}` : `command -v ${command}`;
    execSync(checkCommand, { stdio: 'ignore', timeout: 1000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute grep command and capture output
 */
function execGrep(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
    child.on('error', (err) => reject(new Error(`Failed to start ${command}: ${err.message}`)));
    child.on('close', (code) => {
      const stdoutData = Buffer.concat(stdoutChunks).toString('utf8');
      const stderrData = Buffer.concat(stderrChunks).toString('utf8');

      if (code === 0) resolve(stdoutData);
      else if (code === 1) resolve(''); // No matches
      else reject(new Error(`${command} exited with code ${code}: ${stderrData}`));
    });
  });
}

/**
 * Fallback JavaScript implementation for grep
 */
async function jsGrepFallback(
  pattern: string,
  searchPath: string,
  include?: string
): Promise<GrepMatch[]> {
  const globPattern = include || '**/*';
  const ignorePatterns = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'];

  const files = await fg(globPattern, {
    cwd: searchPath,
    dot: true,
    ignore: ignorePatterns,
    absolute: true,
    onlyFiles: true,
  });

  const regex = new RegExp(pattern, 'i');
  const allMatches: GrepMatch[] = [];

  for (const fileAbsolutePath of files) {
    // Skip quarantined files
    if (isPathQuarantined(fileAbsolutePath)) {
      continue;
    }

    try {
      const content = await readFile(fileAbsolutePath, 'utf8');
      const lines = content.split(/\r?\n/);

      lines.forEach((line, index) => {
        if (regex.test(line)) {
          allMatches.push({
            filePath: relative(searchPath, fileAbsolutePath) || basename(fileAbsolutePath),
            lineNumber: index + 1,
            line,
          });
        }
      });
    } catch (error) {
      // Ignore read errors (permission denied, binary files, etc.)
    }
  }

  return allMatches;
}

/**
 * Perform grep search using best available strategy
 */
async function performGrepSearch(
  pattern: string,
  searchPath: string,
  include?: string
): Promise<GrepMatch[]> {
  // Strategy 1: Try ripgrep (fastest)
  if (isCommandAvailableSync('rg')) {
    try {
      const args = ['--line-number', '--no-heading', '--color', 'never', '-i', pattern];
      if (include) {
        args.push('--glob', include);
      }

      const output = await execGrep('rg', args, searchPath);
      return parseGrepOutput(output, searchPath);
    } catch (error) {
      // Fall through to next strategy
    }
  }

  // Strategy 2: Try git grep (if in git repo)
  if (isCommandAvailableSync('git')) {
    try {
      const args = ['grep', '--untracked', '-n', '-E', '--ignore-case', pattern];
      if (include) {
        args.push('--', include);
      }

      const output = await execGrep('git', args, searchPath);
      return parseGrepOutput(output, searchPath);
    } catch (error) {
      // Fall through to next strategy
    }
  }

  // Strategy 3: Try system grep
  if (isCommandAvailableSync('grep')) {
    try {
      const args = [
        '-r',
        '-n',
        '-H',
        '-E',
        '-I',
        '--exclude-dir=node_modules',
        '--exclude-dir=.git',
        '--exclude-dir=dist',
        '--exclude-dir=build',
      ];

      if (include) {
        args.push(`--include=${include}`);
      }

      args.push(pattern, '.');

      const output = await execGrep('grep', args, searchPath);
      return parseGrepOutput(output, searchPath);
    } catch (error) {
      // Fall through to JavaScript fallback
    }
  }

  // Strategy 4: Pure JavaScript fallback
  return jsGrepFallback(pattern, searchPath, include);
}

export const grepTool: Tool = {
  definition: {
    name: 'grep',
    description:
      'Search for a regular expression pattern within file contents across multiple files. Use this to find where specific code, functions, variables, or text appears in a codebase. Very useful for understanding how code is used, finding definitions, or locating specific patterns. Returns matching lines with file paths and line numbers. Faster than reading every file manually.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regular expression pattern to search for (e.g., "function\\s+myFunc", "import.*from")',
        },
        dir_path: {
          type: 'string',
          description: 'Directory to search in. Omit this parameter to search in the current working directory.',
        },
        include: {
          type: 'string',
          description: 'Glob pattern to filter files (e.g., "*.js", "*.{ts,tsx}", "src/**")',
        },
      },
      required: ['pattern'],
    },
  },

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const pattern = input.pattern as string;
    const dirPath = input.dir_path as string | undefined;
    const include = input.include as string | undefined;

    // Validate regex pattern
    try {
      new RegExp(pattern);
    } catch (error: any) {
      return {
        success: false,
        error: `Invalid regular expression: ${error.message}`,
      };
    }

    // Determine search path based on sandbox mode
    let searchPath: string;
    if (context.sandboxed) {
      // In sandboxed mode, strip leading slashes and verify containment
      const safeDirPath = dirPath ? dirPath.replace(/^\/+/, '') : '';
      searchPath = safeDirPath ? resolve(context.workingDirectory, safeDirPath) : context.workingDirectory;

      if (!isPathContained(searchPath, context.workingDirectory)) {
        return {
          success: false,
          error: `Access denied: Path "${searchPath}" is outside the working directory "${context.workingDirectory}"`,
        };
      }
    } else {
      // In supervised mode, allow any path
      searchPath = dirPath ? resolve(context.workingDirectory, dirPath) : context.workingDirectory;
    }

    try {
      const matches = await performGrepSearch(pattern, searchPath, include);

      if (matches.length === 0) {
        return {
          success: true,
          output: `No matches found for pattern "${pattern}"${include ? ` (filter: "${include}")` : ''}`,
          metadata: {
            matchCount: 0,
            pattern,
            include,
          },
        };
      }

      // Group matches by file
      const matchesByFile: Record<string, GrepMatch[]> = {};
      for (const match of matches) {
        if (!matchesByFile[match.filePath]) {
          matchesByFile[match.filePath] = [];
        }
        matchesByFile[match.filePath].push(match);
      }

      // Sort matches within each file by line number
      for (const filePath in matchesByFile) {
        matchesByFile[filePath].sort((a, b) => a.lineNumber - b.lineNumber);
      }

      // Format output
      const matchCount = matches.length;
      const matchTerm = matchCount === 1 ? 'match' : 'matches';
      let output = `Found ${matchCount} ${matchTerm} for pattern "${pattern}"${include ? ` (filter: "${include}")` : ''}:\n---\n`;

      for (const filePath in matchesByFile) {
        output += `File: ${filePath}\n`;
        for (const match of matchesByFile[filePath]) {
          const trimmedLine = match.line.trim();
          output += `L${match.lineNumber}: ${trimmedLine}\n`;
        }
        output += '---\n';
      }

      return {
        success: true,
        output: output.trim(),
        metadata: {
          matchCount,
          fileCount: Object.keys(matchesByFile).length,
          pattern,
          include,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Grep search failed: ${error.message}`,
      };
    }
  },
};
