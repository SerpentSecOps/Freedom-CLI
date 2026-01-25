/**
 * Terminal Manager - Manages interactive PTY sessions
 * Provides cross-platform support for interactive terminal commands
 */

import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import * as os from 'os';

export interface TerminalSession {
  id: string;
  ptyProcess: pty.IPty;
  outputBuffer: string;
  isRunning: boolean;
  startTime: number;
  cwd: string;
  command: string;
}

export interface TerminalStartOptions {
  command: string;
  cwd: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

// Special key mappings - convert {key} format to ANSI escape sequences
const SPECIAL_KEYS: Record<string, string> = {
  '{enter}': '\r',
  '{return}': '\r',
  '{up}': '\x1b[A',
  '{down}': '\x1b[B',
  '{left}': '\x1b[D',
  '{right}': '\x1b[C',
  '{backspace}': '\x7f',
  '{delete}': '\x1b[3~',
  '{tab}': '\t',
  '{escape}': '\x1b',
  '{esc}': '\x1b',
  '{ctrl+c}': '\x03',
  '{ctrl+d}': '\x04',
  '{ctrl+z}': '\x1a',
  '{ctrl+l}': '\x0c',
  '{home}': '\x1b[H',
  '{end}': '\x1b[F',
  '{pageup}': '\x1b[5~',
  '{pagedown}': '\x1b[6~',
  '{space}': ' ',
};

class TerminalManager extends EventEmitter {
  private sessions: Map<string, TerminalSession> = new Map();
  private sessionCounter: number = 0;
  private maxSessions: number = 10;
  private defaultTimeout: number = 600000; // 10 minutes

  /**
   * Get the default shell for the current platform
   */
  private getDefaultShell(): string {
    if (os.platform() === 'win32') {
      return process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || '/bin/bash';
  }

  /**
   * Parse special keys in input string and convert to escape sequences
   */
  parseInput(input: string): string {
    let result = input;
    
    // Replace all special key patterns with their escape sequences
    for (const [key, sequence] of Object.entries(SPECIAL_KEYS)) {
      // Case-insensitive replacement
      const regex = new RegExp(key.replace(/[{}+]/g, '\\$&'), 'gi');
      result = result.replace(regex, sequence);
    }
    
    return result;
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    this.sessionCounter++;
    return `term-${Date.now()}-${this.sessionCounter}`;
  }

  /**
   * Start a new interactive terminal session
   */
  startSession(options: TerminalStartOptions): string {
    // Check session limit
    if (this.sessions.size >= this.maxSessions) {
      // Clean up oldest session
      const oldest = Array.from(this.sessions.entries())
        .sort((a, b) => a[1].startTime - b[1].startTime)[0];
      if (oldest) {
        this.stopSession(oldest[0]);
      }
    }

    const sessionId = this.generateSessionId();
    const shell = this.getDefaultShell();
    const isWindows = os.platform() === 'win32';

    // Build shell arguments to run the command
    const shellArgs = isWindows
      ? ['/c', options.command]
      : ['-c', options.command];

    // Merge environment
    const env = {
      ...process.env,
      ...options.env,
      TERM: 'xterm-256color',
    } as Record<string, string>;

    // Spawn the PTY process
    const ptyProcess = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: options.cols || 120,
      rows: options.rows || 30,
      cwd: options.cwd,
      env,
    });

    const session: TerminalSession = {
      id: sessionId,
      ptyProcess,
      outputBuffer: '',
      isRunning: true,
      startTime: Date.now(),
      cwd: options.cwd,
      command: options.command,
    };

    // Capture output
    ptyProcess.onData((data: string) => {
      session.outputBuffer += data;
      this.emit('data', sessionId, data);
    });

    // Handle exit
    ptyProcess.onExit(({ exitCode, signal }) => {
      session.isRunning = false;
      this.emit('exit', sessionId, exitCode, signal);
    });

    this.sessions.set(sessionId, session);

    // Set up auto-cleanup timeout
    setTimeout(() => {
      if (this.sessions.has(sessionId) && this.sessions.get(sessionId)?.isRunning) {
        this.stopSession(sessionId);
      }
    }, this.defaultTimeout);

    return sessionId;
  }

  /**
   * Write input to a terminal session
   */
  writeToSession(sessionId: string, input: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isRunning) {
      return false;
    }

    // Parse special keys and write to PTY
    const parsedInput = this.parseInput(input);
    session.ptyProcess.write(parsedInput);
    return true;
  }

  /**
   * Read output from a terminal session
   * Returns accumulated output and clears the buffer
   */
  readFromSession(sessionId: string): { output: string; isRunning: boolean } | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    const output = session.outputBuffer;
    session.outputBuffer = ''; // Clear buffer after reading
    
    return {
      output: this.stripAnsiCodes(output),
      isRunning: session.isRunning,
    };
  }

  /**
   * Read output without clearing the buffer (peek)
   */
  peekSession(sessionId: string): { output: string; isRunning: boolean } | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    return {
      output: this.stripAnsiCodes(session.outputBuffer),
      isRunning: session.isRunning,
    };
  }

  /**
   * Stop a terminal session
   */
  stopSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    if (session.isRunning) {
      session.ptyProcess.kill();
      session.isRunning = false;
    }

    this.sessions.delete(sessionId);
    return true;
  }

  /**
   * Check if a session exists and is running
   */
  isSessionRunning(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session?.isRunning ?? false;
  }

  /**
   * Get session info
   */
  getSessionInfo(sessionId: string): { command: string; cwd: string; isRunning: boolean; uptime: number } | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    return {
      command: session.command,
      cwd: session.cwd,
      isRunning: session.isRunning,
      uptime: Date.now() - session.startTime,
    };
  }

  /**
   * List all active sessions
   */
  listSessions(): Array<{ id: string; command: string; isRunning: boolean }> {
    return Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      command: session.command,
      isRunning: session.isRunning,
    }));
  }

  /**
   * Strip ANSI escape codes from output for cleaner display
   */
  private stripAnsiCodes(str: string): string {
    // eslint-disable-next-line no-control-regex
    return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
              .replace(/\x1b\][^\x07]*\x07/g, '') // OSC sequences
              .replace(/\r/g, ''); // Carriage returns
  }

  /**
   * Cleanup all sessions
   */
  cleanup(): void {
    for (const [sessionId] of this.sessions) {
      this.stopSession(sessionId);
    }
  }
}

// Export singleton instance
export const terminalManager = new TerminalManager();
