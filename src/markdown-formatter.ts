import chalk from 'chalk';

/**
 * Formats markdown text with color and styling for terminal output.
 * Inspired by DeepSeek CLI's formatting approach but implemented from scratch.
 */
export class MarkdownFormatter {
  private buffer: string = '';
  private inCodeBlock: boolean = false;

  /**
   * Process a chunk of text and output formatted content.
   * Handles streaming by maintaining state across chunks.
   */
  write(chunk: string): void {
    this.buffer += chunk;

    // Process complete lines from buffer
    const lines = this.buffer.split('\n');

    // Keep the last incomplete line in buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      this.processLine(line + '\n');
    }
  }

  /**
   * Flush any remaining buffered content
   */
  flush(): void {
    if (this.buffer) {
      this.processLine(this.buffer);
      this.buffer = '';
    }
  }

  private processLine(line: string): void {
    // Check for code block delimiters
    if (line.trim().startsWith('```')) {
      this.inCodeBlock = !this.inCodeBlock;
      process.stdout.write(chalk.gray(line));
      return;
    }

    // If inside code block, output as-is with light styling
    if (this.inCodeBlock) {
      process.stdout.write(chalk.white(line));
      return;
    }

    // Format the line and output
    const formatted = this.formatLine(line);
    process.stdout.write(formatted);
  }

  private formatLine(line: string): string {
    let formatted = line;

    // Format headers (# Header, ## Header, ### Header)
    formatted = formatted.replace(/^(#{1,3}) (.+)$/gm, (match, hashes, content) => {
      return chalk.bold.cyan(content) + '\n';
    });

    // Format bold text (**text**)
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, (match, content) => {
      return chalk.bold(content);
    });

    // Format inline code (`code`)
    formatted = formatted.replace(/`([^`]+)`/g, (match, content) => {
      return chalk.bgGray.white(` ${content} `);
    });

    // Format bullet points with colored bullets
    formatted = formatted.replace(/^(\s*)[-*] (.+)$/gm, (match, indent, content) => {
      return indent + chalk.cyan('•') + ' ' + content;
    });

    return formatted;
  }
}

/**
 * Create a new markdown formatter instance
 */
export function createMarkdownFormatter(): MarkdownFormatter {
  return new MarkdownFormatter();
}
