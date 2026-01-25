/**
 * Storage system for sessions and history
 * JSONL-based append-only format inspired by Codex
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { Session, SessionMetadata, Turn } from './types.js';

export class StorageManager {
  private dataDir: string;
  private sessionsDir: string;
  private historyFile: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.sessionsDir = join(dataDir, 'sessions');
    this.historyFile = join(dataDir, 'history.jsonl');

    // Ensure directories exist
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  /**
   * Save a complete session
   */
  public saveSession(session: Session): void {
    const date = new Date(session.metadata.createdAt);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    // Create directory structure: sessions/YYYY/MM/DD/
    const sessionDir = join(this.sessionsDir, String(year), month, day);
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }

    // Write session file as JSONL
    const sessionFile = join(sessionDir, `session-${session.metadata.id}.jsonl`);
    const lines: string[] = [];

    // Metadata line
    lines.push(JSON.stringify({ type: 'metadata', data: session.metadata }));

    // Messages array (critical for resumption!)
    lines.push(JSON.stringify({ type: 'messages', data: session.messages }));

    // Turn lines
    for (const turn of session.turns) {
      lines.push(JSON.stringify({ type: 'turn', data: turn }));
    }

    writeFileSync(sessionFile, lines.join('\n') + '\n');
  }

  /**
   * Append to global history
   */
  public appendHistory(entry: { type: string; data: unknown }): void {
    appendFileSync(this.historyFile, JSON.stringify(entry) + '\n');
  }

  /**
   * Load session from file
   */
  public loadSession(sessionId: string, date: Date): Session | null {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    const sessionFile = join(this.sessionsDir, String(year), month, day, `session-${sessionId}.jsonl`);

    if (!existsSync(sessionFile)) {
      return null;
    }

    const content = readFileSync(sessionFile, 'utf-8');
    const lines = content.trim().split('\n');

    let metadata: SessionMetadata | null = null;
    let messages: any[] = [];
    const turns: Turn[] = [];

    for (const line of lines) {
      const entry = JSON.parse(line);
      if (entry.type === 'metadata') {
        metadata = entry.data;
      } else if (entry.type === 'messages') {
        messages = entry.data;
      } else if (entry.type === 'turn') {
        turns.push(entry.data);
      }
    }

    if (!metadata) {
      return null;
    }

    return {
      metadata,
      messages,
      turns,
    };
  }

  /**
   * Get recent sessions
   */
  public getRecentSessions(limit: number = 10): SessionMetadata[] {
    // Simple implementation: just read history file
    if (!existsSync(this.historyFile)) {
      return [];
    }

    const content = readFileSync(this.historyFile, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    const sessions: SessionMetadata[] = [];
    for (const line of lines.slice(-limit)) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'session_start') {
          sessions.push(entry.data);
        }
      } catch {
        continue;
      }
    }

    return sessions.reverse();
  }

  /**
   * Get the most recent session file
   */
  public getMostRecentSession(): Session | null {
    if (!existsSync(this.sessionsDir)) {
      return null;
    }

    // Find all session files recursively
    const sessionFiles: Array<{ path: string; mtime: number }> = [];

    const walkDir = (dir: string) => {
      if (!existsSync(dir)) return;

      const items = readdirSync(dir);
      for (const item of items) {
        const fullPath = join(dir, item);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          walkDir(fullPath);
        } else if (item.startsWith('session-') && item.endsWith('.jsonl')) {
          sessionFiles.push({ path: fullPath, mtime: stat.mtimeMs });
        }
      }
    };

    walkDir(this.sessionsDir);

    if (sessionFiles.length === 0) {
      return null;
    }

    // Sort by mtime descending
    sessionFiles.sort((a, b) => b.mtime - a.mtime);

    // Load the most recent session
    const mostRecent = sessionFiles[0];
    const content = readFileSync(mostRecent.path, 'utf-8');
    const lines = content.trim().split('\n');

    let metadata: SessionMetadata | null = null;
    let messages: any[] = [];
    const turns: Turn[] = [];

    for (const line of lines) {
      const entry = JSON.parse(line);
      if (entry.type === 'metadata') {
        metadata = entry.data;
      } else if (entry.type === 'messages') {
        messages = entry.data;
      } else if (entry.type === 'turn') {
        turns.push(entry.data);
      }
    }

    if (!metadata) {
      return null;
    }

    return {
      metadata,
      messages,
      turns,
    };
  }

  /**
   * List all sessions with metadata
   */
  public listAllSessions(): Array<{ id: string; createdAt: number; workingDirectory: string; totalTurns: number }> {
    if (!existsSync(this.sessionsDir)) {
      return [];
    }

    const sessions: Array<{ id: string; createdAt: number; workingDirectory: string; totalTurns: number }> = [];

    const walkDir = (dir: string) => {
      if (!existsSync(dir)) return;

      const items = readdirSync(dir);
      for (const item of items) {
        const fullPath = join(dir, item);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          walkDir(fullPath);
        } else if (item.startsWith('session-') && item.endsWith('.jsonl')) {
          try {
            const content = readFileSync(fullPath, 'utf-8');
            const lines = content.trim().split('\n');

            for (const line of lines) {
              const entry = JSON.parse(line);
              if (entry.type === 'metadata') {
                const metadata = entry.data as SessionMetadata;
                sessions.push({
                  id: metadata.id,
                  createdAt: metadata.createdAt,
                  workingDirectory: metadata.workingDirectory,
                  totalTurns: metadata.totalTurns,
                });
                break;
              }
            }
          } catch {
            continue;
          }
        }
      }
    };

    walkDir(this.sessionsDir);

    // Sort by createdAt descending
    sessions.sort((a, b) => b.createdAt - a.createdAt);

    return sessions;
  }
}
