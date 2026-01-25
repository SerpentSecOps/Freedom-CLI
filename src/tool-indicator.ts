/**
 * Tool Execution Indicator - Visual feedback for running tools
 * Inspired by Claude Code's UX patterns but implemented from scratch
 */

import chalk from 'chalk';

export class ToolIndicator {
  private currentTool: string | null = null;
  private startTime: number = 0;
  private spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private currentFrame = 0;
  private interval: NodeJS.Timeout | null = null;

  /**
   * Start showing indicator for a tool
   */
  start(toolName: string, description?: string): void {
    this.currentTool = toolName;
    this.startTime = Date.now();
    this.currentFrame = 0;

    // Clear any existing interval
    if (this.interval) {
      clearInterval(this.interval);
    }

    // Show initial status
    const displayText = description || this.getDefaultDescription(toolName);
    process.stderr.write(`${chalk.cyan(this.spinnerFrames[0])} ${chalk.bold(toolName)}: ${chalk.gray(displayText)}`);

    // Start spinner animation
    this.interval = setInterval(() => {
      this.currentFrame = (this.currentFrame + 1) % this.spinnerFrames.length;
      const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);

      // Clear current line and redraw
      process.stderr.write('\r\x1b[K'); // Clear line
      process.stderr.write(
        `${chalk.cyan(this.spinnerFrames[this.currentFrame])} ${chalk.bold(toolName)}: ${chalk.gray(displayText)} ${chalk.dim(`(${elapsed}s)`)}`
      );
    }, 80); // Update every 80ms for smooth animation
  }

  /**
   * Stop the indicator and show completion status
   */
  stop(success: boolean, errorMessage?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    if (!this.currentTool) return;

    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);

    // Clear current line
    process.stderr.write('\r\x1b[K');

    // Show final status
    if (success) {
      process.stderr.write(
        `${chalk.green('✓')} ${chalk.bold(this.currentTool)} ${chalk.dim(`(${elapsed}s)`)}\n`
      );
    } else {
      process.stderr.write(
        `${chalk.red('✗')} ${chalk.bold(this.currentTool)} ${chalk.dim(`(${elapsed}s)`)}\n`
      );
      if (errorMessage) {
        process.stderr.write(`  ${chalk.red('Error:')} ${errorMessage}\n`);
      }
    }

    this.currentTool = null;
  }

  /**
   * Update the description while tool is running
   */
  update(description: string): void {
    if (!this.currentTool || !this.interval) return;

    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    process.stderr.write('\r\x1b[K'); // Clear line
    process.stderr.write(
      `${chalk.cyan(this.spinnerFrames[this.currentFrame])} ${chalk.bold(this.currentTool)}: ${chalk.gray(description)} ${chalk.dim(`(${elapsed}s)`)}`
    );
  }

  /**
   * Get default description for common tools
   */
  private getDefaultDescription(toolName: string): string {
    const defaults: Record<string, string> = {
      'read': 'Reading file...',
      'write': 'Writing file...',
      'edit': 'Editing file...',
      'bash': 'Executing command...',
      'glob': 'Finding files...',
      'grep': 'Searching content...',
      'git_status': 'Checking repository status...',
      'git_diff': 'Getting diff...',
      'git_commit': 'Creating commit...',
      'git_push': 'Pushing to remote...',
      'task_output': 'Retrieving task output...',
    };

    return defaults[toolName.toLowerCase()] || 'Executing...';
  }

  /**
   * Check if indicator is currently active
   */
  isActive(): boolean {
    return this.currentTool !== null;
  }
}

// Global singleton instance
export const toolIndicator = new ToolIndicator();
