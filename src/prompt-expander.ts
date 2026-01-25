/**
 * Prompt Expander - Expands @{file} and !{command} injections in user prompts
 * Inspired by Gemini CLI's prompt processors, implemented from scratch
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { extractInjections } from './injection-parser.js';

const FILE_INJECTION_TRIGGER = '@{';
const SHELL_INJECTION_TRIGGER = '!{';

export interface ExpandResult {
  /** The expanded prompt text */
  text: string;
  /** Any warnings or informational messages */
  warnings: string[];
}

/**
 * Expands injections in a user prompt:
 * - @{file.txt} → contents of file.txt
 * - !{ls -la} → output of shell command
 *
 * @param prompt The user's original prompt
 * @param workingDir The working directory for relative paths and commands
 * @param autoApprove Whether to auto-approve shell commands (otherwise throw error)
 * @returns ExpandResult with expanded text and any warnings
 */
export async function expandPrompt(
  prompt: string,
  workingDir: string,
  autoApprove: boolean
): Promise<ExpandResult> {
  const warnings: string[] = [];
  let expandedText = prompt;

  // First, expand file injections (@{...})
  if (expandedText.includes(FILE_INJECTION_TRIGGER)) {
    const result = await expandFileInjections(expandedText, workingDir);
    expandedText = result.text;
    warnings.push(...result.warnings);
  }

  // Then, expand shell injections (!{...})
  if (expandedText.includes(SHELL_INJECTION_TRIGGER)) {
    const result = await expandShellInjections(
      expandedText,
      workingDir,
      autoApprove
    );
    expandedText = result.text;
    warnings.push(...result.warnings);
  }

  return { text: expandedText, warnings };
}

async function expandFileInjections(
  prompt: string,
  workingDir: string
): Promise<ExpandResult> {
  const warnings: string[] = [];
  const injections = extractInjections(prompt, FILE_INJECTION_TRIGGER);

  if (injections.length === 0) {
    return { text: prompt, warnings };
  }

  let result = '';
  let lastIndex = 0;

  for (const injection of injections) {
    // Add text before injection
    result += prompt.substring(lastIndex, injection.startIndex);

    const filePath = injection.content;
    try {
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.join(workingDir, filePath);

      const fileContent = fs.readFileSync(absolutePath, 'utf-8');
      result += `\n<file_content path="${filePath}">\n${fileContent}\n</file_content>\n`;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to inject file '@{${filePath}}': ${message}`);
      // Leave placeholder in prompt on error
      result += prompt.substring(injection.startIndex, injection.endIndex);
    }

    lastIndex = injection.endIndex;
  }

  // Add remaining text after last injection
  result += prompt.substring(lastIndex);

  return { text: result, warnings };
}

async function expandShellInjections(
  prompt: string,
  workingDir: string,
  autoApprove: boolean
): Promise<ExpandResult> {
  const warnings: string[] = [];
  const injections = extractInjections(prompt, SHELL_INJECTION_TRIGGER);

  if (injections.length === 0) {
    return { text: prompt, warnings };
  }

  // Security check: require auto-approve for shell commands
  if (!autoApprove) {
    const commands = injections.map((inj) => inj.content).filter((c) => c);
    if (commands.length > 0) {
      throw new Error(
        `Shell command injections require --auto-approve flag. Commands found: ${commands.join(', ')}`
      );
    }
  }

  let result = '';
  let lastIndex = 0;

  for (const injection of injections) {
    // Add text before injection
    result += prompt.substring(lastIndex, injection.startIndex);

    const command = injection.content;
    if (!command) {
      lastIndex = injection.endIndex;
      continue;
    }

    try {
      const output = execSync(command, {
        cwd: workingDir,
        encoding: 'utf-8',
        timeout: 30000, // 30 second timeout
        maxBuffer: 10 * 1024 * 1024, // 10MB max output
      });
      result += output;
    } catch (error: any) {
      const message =
        error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to execute command '!{${command}}': ${message}`);

      // Include error output if available
      if (error.stderr) {
        result += `[Command failed: ${error.stderr}]`;
      } else if (error.stdout) {
        result += error.stdout;
      } else {
        result += `[Command execution failed]`;
      }
    }

    lastIndex = injection.endIndex;
  }

  // Add remaining text after last injection
  result += prompt.substring(lastIndex);

  return { text: result, warnings };
}
