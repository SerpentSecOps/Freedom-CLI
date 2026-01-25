/**
 * Terminal window title utilities
 * Sets dynamic window titles based on CLI context
 */

import { basename } from 'path';

/**
 * ANSI escape sequences for setting terminal window title
 * OSC 0 - Set icon name and window title
 * OSC 2 - Set window title only
 */
const OSC = '\x1B]';
const BEL = '\x07';
const ST = '\x1B\\';

/**
 * Set the terminal window title
 * Uses OSC escape sequences compatible with most terminals
 * Supports both BEL and ST terminators for compatibility
 */
export function setWindowTitle(title: string): void {
  // Skip if not in a TTY (piped output, non-interactive)
  if (!process.stdout.isTTY) {
    return;
  }

  // Remove control characters that could cause issues
  const sanitized = title.replace(
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1F\x7F]/g,
    ''
  );

  // Set window title using OSC 2 (window title only)
  // Try BEL terminator (more common) first
  process.stdout.write(`${OSC}2;${sanitized}${BEL}`);
}

/**
 * Compute window title for Freedom CLI
 * Shows mode, folder, and session info
 */
export function computeWindowTitle(options: {
  mode: 'chat' | 'exec' | 'resume';
  folder?: string;
  sessionId?: string;
  customTitle?: string;
}): string {
  // Allow override via environment variable
  if (process.env.CLI_TITLE) {
    return process.env.CLI_TITLE;
  }

  // Use custom title if provided
  if (options.customTitle) {
    return options.customTitle;
  }

  // Get folder name
  const folderName = options.folder ? basename(options.folder) : basename(process.cwd());

  // Build title based on mode
  switch (options.mode) {
    case 'chat':
      return `Freedom CLI - ${folderName}`;
    case 'exec':
      return `Freedom CLI [exec] - ${folderName}`;
    case 'resume':
      return options.sessionId
        ? `Freedom CLI [resume:${options.sessionId.slice(0, 8)}] - ${folderName}`
        : `Freedom CLI [resume] - ${folderName}`;
    default:
      return `Freedom CLI - ${folderName}`;
  }
}

/**
 * Reset window title to default terminal title
 */
export function resetWindowTitle(): void {
  if (process.stdout.isTTY) {
    // Empty title resets to default
    process.stdout.write(`${OSC}2;${BEL}`);
  }
}
