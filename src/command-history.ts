/**
 * Persistent command history across sessions
 * Stores commands in ~/.freedom-cli/history.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const MAX_HISTORY_SIZE = 1000;

interface HistoryEntry {
  command: string;
  timestamp: number;
  workingDirectory?: string;
}

class CommandHistory {
  private static instance: CommandHistory;
  private history: HistoryEntry[] = [];
  private historyPath: string;
  private currentIndex: number = -1; // -1 means not navigating history

  private constructor() {
    const dataDir = join(homedir(), '.freedom-cli');
    this.historyPath = join(dataDir, 'history.json');
    this.loadHistory(dataDir);
  }

  public static getInstance(): CommandHistory {
    if (!CommandHistory.instance) {
      CommandHistory.instance = new CommandHistory();
    }
    return CommandHistory.instance;
  }

  private loadHistory(dataDir: string): void {
    // Ensure data directory exists
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    if (existsSync(this.historyPath)) {
      try {
        const content = readFileSync(this.historyPath, 'utf-8');
        const data = JSON.parse(content);
        this.history = Array.isArray(data) ? data : [];
      } catch (error) {
        // If file is corrupted, start fresh
        this.history = [];
      }
    }
  }

  private saveHistory(): void {
    try {
      writeFileSync(this.historyPath, JSON.stringify(this.history, null, 2), 'utf-8');
    } catch (error) {
      // Silently fail - don't interrupt user flow for history issues
    }
  }

  /**
   * Add a command to history
   */
  public add(command: string, workingDirectory?: string): void {
    const trimmed = command.trim();

    // Don't add empty commands or duplicates of the last command
    if (!trimmed) return;
    if (this.history.length > 0 && this.history[this.history.length - 1].command === trimmed) {
      return;
    }

    // Don't save sensitive commands
    if (trimmed.toLowerCase().startsWith('/config') && trimmed.includes('api')) {
      return;
    }

    this.history.push({
      command: trimmed,
      timestamp: Date.now(),
      workingDirectory,
    });

    // Trim history if too large
    if (this.history.length > MAX_HISTORY_SIZE) {
      this.history = this.history.slice(-MAX_HISTORY_SIZE);
    }

    this.saveHistory();
    this.resetNavigation();
  }

  /**
   * Reset navigation index (call when starting new input)
   */
  public resetNavigation(): void {
    this.currentIndex = -1;
  }

  /**
   * Get previous command (Shift+Up)
   */
  public getPrevious(): string | null {
    if (this.history.length === 0) return null;

    if (this.currentIndex === -1) {
      // Start from the end
      this.currentIndex = this.history.length - 1;
    } else if (this.currentIndex > 0) {
      this.currentIndex--;
    }

    return this.history[this.currentIndex]?.command || null;
  }

  /**
   * Get next command (Shift+Down)
   */
  public getNext(): string | null {
    if (this.history.length === 0 || this.currentIndex === -1) return null;

    if (this.currentIndex < this.history.length - 1) {
      this.currentIndex++;
      return this.history[this.currentIndex].command;
    } else {
      // At the end, reset and return null (empty input)
      this.currentIndex = -1;
      return '';
    }
  }

  /**
   * Get all history entries (for search/display)
   */
  public getAll(): HistoryEntry[] {
    return [...this.history];
  }

  /**
   * Search history for commands containing a string
   */
  public search(query: string): HistoryEntry[] {
    const lower = query.toLowerCase();
    return this.history.filter(entry =>
      entry.command.toLowerCase().includes(lower)
    );
  }

  /**
   * Get the current history size
   */
  public size(): number {
    return this.history.length;
  }

  /**
   * Clear all history
   */
  public clear(): void {
    this.history = [];
    this.currentIndex = -1;
    this.saveHistory();
  }
}

// Export singleton accessor
export function getCommandHistory(): CommandHistory {
  return CommandHistory.getInstance();
}
