/**
 * Environment validation and diagnostics for Freedom CLI.
 * Inspired by DeepSeek CLI's setup command pattern.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from './config.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export interface DiagnosticResult {
  category: string;
  status: 'success' | 'warning' | 'error';
  message: string;
  details?: string;
  suggestion?: string;
}

/**
 * Run comprehensive environment diagnostics.
 * Returns array of diagnostic results for display.
 */
export async function runDiagnostics(): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];

  // Check 1: API Key Configuration
  results.push(await checkApiKey());

  // Check 2: API Connectivity
  results.push(await checkApiConnectivity());

  // Check 3: Session Directory
  results.push(await checkSessionDirectory());

  // Check 4: Config File
  results.push(await checkConfigFile());

  // Check 5: Node.js Version
  results.push(checkNodeVersion());

  // Check 6: Disk Space
  results.push(await checkDiskSpace());

  return results;
}

/**
 * Check if API key is configured.
 */
async function checkApiKey(): Promise<DiagnosticResult> {
  const config = await getConfig();

  if (!config.apiKey) {
    return {
      category: 'API Key',
      status: 'error',
      message: 'No API key configured',
      suggestion: 'Set ANTHROPIC_API_KEY environment variable or add apiKey to ~/.freedom-cli/config.json',
    };
  }

  // Validate format (should start with sk-ant-)
  if (!config.apiKey.startsWith('sk-ant-')) {
    return {
      category: 'API Key',
      status: 'warning',
      message: 'API key format looks unusual',
      details: 'Expected format: sk-ant-...',
      suggestion: 'Verify your API key from https://console.anthropic.com',
    };
  }

  return {
    category: 'API Key',
    status: 'success',
    message: 'API key is configured',
    details: `Key: ${config.apiKey.substring(0, 12)}...`,
  };
}

/**
 * Test actual API connectivity with minimal request.
 */
async function checkApiConnectivity(): Promise<DiagnosticResult> {
  const config = await getConfig();

  if (!config.apiKey) {
    return {
      category: 'API Connection',
      status: 'error',
      message: 'Cannot test - no API key',
    };
  }

  try {
    const client = new Anthropic({ apiKey: config.apiKey });

    // Minimal test request (1 token output)
    await client.messages.create({
      model: config.model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    });

    return {
      category: 'API Connection',
      status: 'success',
      message: 'Successfully connected to Anthropic API',
      details: `Model: ${config.model}`,
    };
  } catch (error: any) {
    if (error.status === 401) {
      return {
        category: 'API Connection',
        status: 'error',
        message: 'Authentication failed',
        details: 'Invalid API key',
        suggestion: 'Check your API key at https://console.anthropic.com',
      };
    } else if (error.status === 429) {
      return {
        category: 'API Connection',
        status: 'warning',
        message: 'Rate limit reached',
        details: 'Too many requests',
        suggestion: 'Wait a moment and try again',
      };
    } else if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
      return {
        category: 'API Connection',
        status: 'error',
        message: 'Network error',
        details: 'Cannot reach api.anthropic.com',
        suggestion: 'Check your internet connection',
      };
    } else {
      return {
        category: 'API Connection',
        status: 'error',
        message: 'API request failed',
        details: error.message,
      };
    }
  }
}

/**
 * Check session storage directory.
 */
async function checkSessionDirectory(): Promise<DiagnosticResult> {
  const sessionDir = path.join(os.homedir(), '.freedom-cli', 'sessions');

  try {
    const stats = await fs.stat(sessionDir);

    if (!stats.isDirectory()) {
      return {
        category: 'Session Storage',
        status: 'error',
        message: 'Session path exists but is not a directory',
        details: sessionDir,
      };
    }

    // Check write permissions by trying to create a test file
    const testFile = path.join(sessionDir, '.write-test');
    try {
      await fs.writeFile(testFile, '');
      await fs.unlink(testFile);

      return {
        category: 'Session Storage',
        status: 'success',
        message: 'Session directory is writable',
        details: sessionDir,
      };
    } catch {
      return {
        category: 'Session Storage',
        status: 'error',
        message: 'Session directory is not writable',
        details: sessionDir,
        suggestion: 'Check file permissions',
      };
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return {
        category: 'Session Storage',
        status: 'warning',
        message: 'Session directory does not exist',
        details: 'Will be created on first use',
      };
    } else {
      return {
        category: 'Session Storage',
        status: 'error',
        message: 'Cannot access session directory',
        details: error.message,
      };
    }
  }
}

/**
 * Check config file status.
 */
async function checkConfigFile(): Promise<DiagnosticResult> {
  const configPath = path.join(os.homedir(), '.freedom-cli', 'config.json');

  try {
    const content = await fs.readFile(configPath, 'utf-8');

    // Try to parse it
    try {
      JSON.parse(content);
      return {
        category: 'Config File',
        status: 'success',
        message: 'Config file is valid',
        details: configPath,
      };
    } catch {
      return {
        category: 'Config File',
        status: 'error',
        message: 'Config file has invalid JSON',
        details: configPath,
        suggestion: 'Fix JSON syntax errors',
      };
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return {
        category: 'Config File',
        status: 'success',
        message: 'Using default configuration',
        details: 'No config file found (this is fine)',
      };
    } else {
      return {
        category: 'Config File',
        status: 'warning',
        message: 'Cannot read config file',
        details: error.message,
      };
    }
  }
}

/**
 * Check Node.js version.
 */
function checkNodeVersion(): DiagnosticResult {
  const version = process.version;
  const majorVersion = parseInt(version.slice(1).split('.')[0]);

  // Require Node.js 18+
  if (majorVersion < 18) {
    return {
      category: 'Node.js',
      status: 'error',
      message: `Node.js version too old: ${version}`,
      details: 'Minimum required: v18.0.0',
      suggestion: 'Update Node.js from https://nodejs.org',
    };
  }

  return {
    category: 'Node.js',
    status: 'success',
    message: `Node.js ${version}`,
  };
}

/**
 * Check available disk space in session directory.
 */
async function checkDiskSpace(): Promise<DiagnosticResult> {
  const sessionDir = path.join(os.homedir(), '.freedom-cli');

  try {
    // Count session files
    const sessionsPath = path.join(sessionDir, 'sessions');
    let fileCount = 0;
    let totalSize = 0;

    try {
      const files = await fs.readdir(sessionsPath);
      fileCount = files.filter((f) => f.endsWith('.jsonl')).length;

      // Calculate total size
      for (const file of files) {
        if (file.endsWith('.jsonl')) {
          const stats = await fs.stat(path.join(sessionsPath, file));
          totalSize += stats.size;
        }
      }
    } catch {
      // Directory doesn't exist yet
    }

    const sizeMB = (totalSize / 1024 / 1024).toFixed(2);

    if (totalSize > 100 * 1024 * 1024) {
      // > 100MB
      return {
        category: 'Disk Usage',
        status: 'warning',
        message: `Session storage is large: ${sizeMB} MB`,
        details: `${fileCount} session files`,
        suggestion: 'Consider running session cleanup (configured in config.json)',
      };
    }

    return {
      category: 'Disk Usage',
      status: 'success',
      message: `Session storage: ${sizeMB} MB`,
      details: `${fileCount} session files`,
    };
  } catch (error: any) {
    return {
      category: 'Disk Usage',
      status: 'warning',
      message: 'Cannot check disk usage',
      details: error.message,
    };
  }
}

/**
 * Format diagnostic results for console display.
 */
export function formatDiagnostics(results: DiagnosticResult[]): string {
  const lines: string[] = [];

  lines.push('\n🏥 Freedom CLI Environment Diagnostics\n');

  for (const result of results) {
    const icon = result.status === 'success' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';

    lines.push(`${icon} ${result.category}: ${result.message}`);

    if (result.details) {
      lines.push(`   ${result.details}`);
    }

    if (result.suggestion) {
      lines.push(`   💡 ${result.suggestion}`);
    }

    lines.push(''); // Blank line
  }

  // Summary
  const successCount = results.filter((r) => r.status === 'success').length;
  const warningCount = results.filter((r) => r.status === 'warning').length;
  const errorCount = results.filter((r) => r.status === 'error').length;

  if (errorCount > 0) {
    lines.push(`⚠️  ${errorCount} error(s) found - CLI may not work correctly`);
  } else if (warningCount > 0) {
    lines.push(`⚠️  ${warningCount} warning(s) - CLI should work but check recommendations`);
  } else {
    lines.push('✅ All checks passed - Freedom CLI is ready to use!');
  }

  lines.push('');

  return lines.join('\n');
}
