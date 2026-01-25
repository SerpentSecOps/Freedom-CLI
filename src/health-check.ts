/**
 * Health Check Module
 * Validates API connectivity and configuration before starting sessions
 * Inspired by DeepSeek CLI's connection validation pattern
 */

import Anthropic from '@anthropic-ai/sdk';
import chalk from 'chalk';

export interface HealthCheckResult {
  ok: boolean;
  message?: string;
  suggestions?: string[];
}

/**
 * Check if Anthropic API key is valid and accessible
 */
export async function checkAnthropicConnection(apiKey: string): Promise<HealthCheckResult> {
  if (!apiKey) {
    return {
      ok: false,
      message: 'API key not configured',
      suggestions: [
        'Set ANTHROPIC_API_KEY environment variable',
        'Or add "apiKey" to ~/.freedom-cli/config.json',
        'Get your API key from: https://console.anthropic.com/'
      ]
    };
  }

  try {
    // Make a minimal API call to validate the key
    const client = new Anthropic({ apiKey });
    await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'test' }]
    });

    return { ok: true };
  } catch (error: any) {
    if (error?.status === 401) {
      return {
        ok: false,
        message: 'Invalid API key',
        suggestions: [
          'Check that your ANTHROPIC_API_KEY is correct',
          'Get a new key from: https://console.anthropic.com/'
        ]
      };
    }

    if (error?.status === 429) {
      return {
        ok: false,
        message: 'Rate limit exceeded',
        suggestions: [
          'Wait a moment before retrying',
          'Check your API usage at: https://console.anthropic.com/'
        ]
      };
    }

    if (error?.code === 'ENOTFOUND' || error?.code === 'ECONNREFUSED') {
      return {
        ok: false,
        message: 'Cannot reach Anthropic API',
        suggestions: [
          'Check your internet connection',
          'Verify network/firewall settings'
        ]
      };
    }

    // Unknown error - allow to proceed but warn
    return {
      ok: true,
      message: `Warning: ${error.message}`
    };
  }
}

/**
 * Display health check results to user
 */
export function displayHealthCheck(result: HealthCheckResult): void {
  if (result.ok && !result.message) {
    console.log(chalk.green('✅ API connection OK'));
    return;
  }

  if (result.ok && result.message) {
    console.log(chalk.yellow(`⚠️  ${result.message}`));
    return;
  }

  // Failed health check
  console.log(chalk.red(`⚠️  ${result.message}`));
  if (result.suggestions) {
    for (const suggestion of result.suggestions) {
      console.log(chalk.yellow(`   ${suggestion}`));
    }
  }
  console.log('');
}

/**
 * Run health check with optional quiet mode
 */
export async function runHealthCheck(
  apiKey: string,
  provider: string = 'anthropic',
  quiet: boolean = false
): Promise<boolean> {
  if (provider !== 'anthropic') {
    // Only Anthropic supported for now
    return true;
  }

  if (quiet) {
    const result = await checkAnthropicConnection(apiKey);
    return result.ok;
  }

  const result = await checkAnthropicConnection(apiKey);
  displayHealthCheck(result);
  return result.ok;
}
