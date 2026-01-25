/**
 * Version check system - checks npm registry for updates
 * Inspired by Gemini CLI's updateCheck.ts but implemented from scratch
 */

import https from 'https';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface VersionInfo {
  current: string;
  latest: string;
  needsUpdate: boolean;
  packageName: string;
}

/**
 * Compare two semantic versions (basic implementation)
 */
function compareVersions(current: string, latest: string): boolean {
  const parseCurrent = current.split('.').map(Number);
  const parseLatest = latest.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const c = parseCurrent[i] || 0;
    const l = parseLatest[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

/**
 * Fetch latest version from npm registry
 */
async function fetchLatestVersion(packageName: string, timeoutMs = 2000): Promise<string | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve(null);
    }, timeoutMs);

    const req = https.get(
      `https://registry.npmjs.org/${packageName}/latest`,
      { timeout: timeoutMs },
      (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          clearTimeout(timeout);
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.version || null);
          } catch {
            resolve(null);
          }
        });
      }
    );

    req.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });

    req.on('timeout', () => {
      req.destroy();
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

/**
 * Check for updates by comparing current version with npm registry
 */
export async function checkForUpdates(disableCheck = false): Promise<VersionInfo | null> {
  try {
    // Skip if disabled or in dev mode
    if (disableCheck || process.env.DEV === 'true') {
      return null;
    }

    // Read package.json to get current version
    const packageJsonPath = join(__dirname, '..', 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    const currentVersion = packageJson.version;
    const packageName = packageJson.name;

    if (!currentVersion || !packageName) {
      return null;
    }

    // Fetch latest version from npm
    const latestVersion = await fetchLatestVersion(packageName);

    if (!latestVersion) {
      return null;
    }

    // Compare versions
    const needsUpdate = compareVersions(currentVersion, latestVersion);

    return {
      current: currentVersion,
      latest: latestVersion,
      needsUpdate,
      packageName,
    };
  } catch {
    // Silent fail - version check is not critical
    return null;
  }
}

/**
 * Format update message for display
 */
export function formatUpdateMessage(info: VersionInfo): string {
  if (!info.needsUpdate) {
    return '';
  }

  return `\n💡 Update available! ${info.current} → ${info.latest}\n   Run: npm install -g ${info.packageName}\n`;
}
