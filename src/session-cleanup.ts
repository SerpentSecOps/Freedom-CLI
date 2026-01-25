/**
 * Automatic session cleanup system
 * Prevents unbounded session storage growth
 */

import { existsSync, readdirSync, statSync, unlinkSync, readFileSync, rmdirSync } from 'fs';
import { join } from 'path';
import type { SessionMetadata } from './types.js';

// Time multipliers for retention period parsing
const TIME_MULTIPLIERS = {
  h: 60 * 60 * 1000,           // hours to ms
  d: 24 * 60 * 60 * 1000,      // days to ms
  w: 7 * 24 * 60 * 60 * 1000,  // weeks to ms
  m: 30 * 24 * 60 * 60 * 1000, // months (30 days) to ms
};

export interface SessionCleanupConfig {
  enabled: boolean;
  maxAge?: string;      // e.g., "30d", "7d", "24h"
  maxCount?: number;    // Keep only N most recent sessions
  minRetention?: string; // Minimum retention period (default: "1d")
}

export interface CleanupResult {
  disabled: boolean;
  scanned: number;
  deleted: number;
  skipped: number;
  failed: number;
}

interface SessionFileInfo {
  path: string;
  metadata: SessionMetadata | null;
  mtime: number;
}

/**
 * Main entry point for session cleanup
 */
export async function cleanupSessions(
  sessionsDir: string,
  config: SessionCleanupConfig,
  verbose: boolean = false
): Promise<CleanupResult> {
  const result: CleanupResult = {
    disabled: false,
    scanned: 0,
    deleted: 0,
    skipped: 0,
    failed: 0,
  };

  try {
    // Early exit if cleanup is disabled
    if (!config.enabled) {
      return { ...result, disabled: true };
    }

    // Validate configuration
    const validationError = validateConfig(config);
    if (validationError) {
      if (verbose) {
        console.error(`Session cleanup disabled: ${validationError}`);
      }
      return { ...result, disabled: true };
    }

    // Get all session files
    const sessionFiles = getAllSessionFiles(sessionsDir);
    result.scanned = sessionFiles.length;

    if (sessionFiles.length === 0) {
      return result;
    }

    // Identify sessions to delete
    const sessionsToDelete = identifySessionsToDelete(sessionFiles, config);

    // Delete identified sessions
    for (const sessionFile of sessionsToDelete) {
      try {
        unlinkSync(sessionFile.path);

        if (verbose && sessionFile.metadata) {
          console.log(`Deleted expired session: ${sessionFile.metadata.id}`);
        }

        result.deleted++;
      } catch (error) {
        // Ignore ENOENT errors (file already deleted)
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          // File already deleted, skip
        } else {
          if (verbose) {
            const sessionId = sessionFile.metadata?.id || 'unknown';
            console.error(`Failed to delete session ${sessionId}:`, error);
          }
          result.failed++;
        }
      }
    }

    // Clean up empty directories
    cleanupEmptyDirectories(sessionsDir);

    result.skipped = result.scanned - result.deleted - result.failed;

    if (verbose && result.deleted > 0) {
      console.log(`Session cleanup: deleted ${result.deleted}, skipped ${result.skipped}, failed ${result.failed}`);
    }
  } catch (error) {
    if (verbose) {
      console.error('Session cleanup failed:', error);
    }
    result.failed++;
  }

  return result;
}

/**
 * Get all session files recursively
 */
function getAllSessionFiles(sessionsDir: string): SessionFileInfo[] {
  const sessionFiles: SessionFileInfo[] = [];

  if (!existsSync(sessionsDir)) {
    return sessionFiles;
  }

  const walkDir = (dir: string) => {
    if (!existsSync(dir)) return;

    const items = readdirSync(dir);
    for (const item of items) {
      const fullPath = join(dir, item);

      try {
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          walkDir(fullPath);
        } else if (item.startsWith('session-') && item.endsWith('.jsonl')) {
          // Try to read metadata
          let metadata: SessionMetadata | null = null;
          try {
            const content = readFileSync(fullPath, 'utf-8');
            const lines = content.trim().split('\n');
            for (const line of lines) {
              const entry = JSON.parse(line);
              if (entry.type === 'metadata') {
                metadata = entry.data;
                break;
              }
            }
          } catch {
            // Corrupted file - will be deleted
          }

          sessionFiles.push({
            path: fullPath,
            metadata,
            mtime: stat.mtimeMs,
          });
        }
      } catch {
        // Skip files we can't read
        continue;
      }
    }
  };

  walkDir(sessionsDir);

  return sessionFiles;
}

/**
 * Identify sessions that should be deleted
 */
function identifySessionsToDelete(
  sessionFiles: SessionFileInfo[],
  config: SessionCleanupConfig
): SessionFileInfo[] {
  const toDelete: SessionFileInfo[] = [];

  // Delete corrupted files (no metadata)
  toDelete.push(...sessionFiles.filter(f => f.metadata === null));

  // Handle valid sessions
  const validSessions = sessionFiles.filter(f => f.metadata !== null);
  if (validSessions.length === 0) {
    return toDelete;
  }

  const now = Date.now();

  // Calculate cutoff date for age-based retention
  let cutoffTime: number | null = null;
  if (config.maxAge) {
    try {
      const maxAgeMs = parseRetentionPeriod(config.maxAge);
      cutoffTime = now - maxAgeMs;
    } catch {
      // Should not happen due to validation, but handle gracefully
      cutoffTime = null;
    }
  }

  // Sort by creation time (newest first)
  const sortedSessions = [...validSessions].sort(
    (a, b) => (b.metadata?.createdAt || 0) - (a.metadata?.createdAt || 0)
  );

  // Apply retention policies
  for (let i = 0; i < sortedSessions.length; i++) {
    const session = sortedSessions[i];
    const sessionTime = session.metadata?.createdAt || 0;
    let shouldDelete = false;

    // Age-based retention
    if (cutoffTime !== null && sessionTime < cutoffTime) {
      shouldDelete = true;
    }

    // Count-based retention
    if (config.maxCount !== undefined && i >= config.maxCount) {
      shouldDelete = true;
    }

    if (shouldDelete) {
      toDelete.push(session);
    }
  }

  return toDelete;
}

/**
 * Parse retention period (e.g., "30d" -> milliseconds)
 */
function parseRetentionPeriod(period: string): number {
  const match = period.match(/^(\d+)([dhwm])$/);
  if (!match) {
    throw new Error(
      `Invalid retention period format: ${period}. Expected format: <number><unit> where unit is h, d, w, or m`
    );
  }

  const value = parseInt(match[1], 10);
  const unit = match[2] as keyof typeof TIME_MULTIPLIERS;

  if (value === 0) {
    throw new Error(`Invalid retention period: ${period}. Value must be greater than 0`);
  }

  return value * TIME_MULTIPLIERS[unit];
}

/**
 * Validate cleanup configuration
 */
function validateConfig(config: SessionCleanupConfig): string | null {
  if (!config.enabled) {
    return 'Retention not enabled';
  }

  // Validate maxAge if provided
  if (config.maxAge) {
    let maxAgeMs: number;
    try {
      maxAgeMs = parseRetentionPeriod(config.maxAge);
    } catch (error) {
      return String(error);
    }

    // Enforce minimum retention period (default: 1 day)
    const minRetention = config.minRetention || '1d';
    let minRetentionMs: number;
    try {
      minRetentionMs = parseRetentionPeriod(minRetention);
    } catch {
      minRetentionMs = 24 * 60 * 60 * 1000; // Default to 1 day
    }

    if (maxAgeMs < minRetentionMs) {
      return `maxAge cannot be less than minRetention (${minRetention})`;
    }
  }

  // Validate maxCount if provided
  if (config.maxCount !== undefined) {
    if (config.maxCount < 1) {
      return 'maxCount must be at least 1';
    }
  }

  // At least one retention method must be specified
  if (!config.maxAge && config.maxCount === undefined) {
    return 'Either maxAge or maxCount must be specified';
  }

  return null;
}

/**
 * Clean up empty directories in sessions folder
 */
function cleanupEmptyDirectories(sessionsDir: string): void {
  if (!existsSync(sessionsDir)) {
    return;
  }

  const cleanDir = (dir: string) => {
    if (!existsSync(dir)) return;

    const items = readdirSync(dir);

    // First, recursively clean subdirectories
    for (const item of items) {
      const fullPath = join(dir, item);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          cleanDir(fullPath);
        }
      } catch {
        continue;
      }
    }

    // Check if directory is now empty (after cleaning subdirs)
    const remainingItems = readdirSync(dir);
    if (remainingItems.length === 0 && dir !== sessionsDir) {
      try {
        rmdirSync(dir);
      } catch {
        // Ignore errors - directory might not be empty or might be in use
      }
    }
  };

  cleanDir(sessionsDir);
}
