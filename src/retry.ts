/**
 * Retry and error recovery utilities
 * Implements exponential backoff, rate limit handling, and timeout management
 */

export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  timeoutMs?: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  timeoutMs: 30000, // 30 seconds
};

export class RetryableError extends Error {
  constructor(message: string, public readonly retryAfterMs?: number) {
    super(message);
    this.name = 'RetryableError';
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute an async function with timeout
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage?: string
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new TimeoutError(timeoutMessage || `Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle!);
  }
}

/**
 * Classify errors as retryable or not
 */
function isRetryableError(error: any): boolean {
  // Network errors
  if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
    return true;
  }

  // Anthropic API rate limits (429)
  if (error.status === 429) {
    return true;
  }

  // Anthropic API server errors (500-599)
  if (error.status >= 500 && error.status < 600) {
    return true;
  }

  // Overloaded error
  if (error.error?.type === 'overloaded_error') {
    return true;
  }

  // Explicitly marked as retryable
  if (error instanceof RetryableError) {
    return true;
  }

  return false;
}

/**
 * Extract retry-after duration from error
 */
function getRetryAfterMs(error: any): number | undefined {
  if (error instanceof RetryableError && error.retryAfterMs) {
    return error.retryAfterMs;
  }

  // Check for Retry-After header in API response
  if (error.headers?.['retry-after']) {
    const retryAfter = parseInt(error.headers['retry-after'], 10);
    if (!isNaN(retryAfter)) {
      return retryAfter * 1000; // Convert seconds to ms
    }
  }

  return undefined;
}

/**
 * Execute a function with retry logic and exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  onRetry?: (attempt: number, error: any, delayMs: number) => void
): Promise<T> {
  const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: any;

  for (let attempt = 1; attempt <= finalConfig.maxAttempts; attempt++) {
    try {
      // Execute with timeout if configured
      const promise = fn();
      const result = finalConfig.timeoutMs
        ? await withTimeout(promise, finalConfig.timeoutMs)
        : await promise;

      return result;
    } catch (error: any) {
      lastError = error;

      // If this is the last attempt, throw
      if (attempt === finalConfig.maxAttempts) {
        break;
      }

      // Check if error is retryable
      if (!isRetryableError(error)) {
        throw error; // Don't retry non-retryable errors
      }

      // Calculate delay with exponential backoff
      const exponentialDelay = Math.min(
        finalConfig.initialDelayMs * Math.pow(finalConfig.backoffMultiplier, attempt - 1),
        finalConfig.maxDelayMs
      );

      // Use retry-after if provided, otherwise use exponential backoff
      const retryAfter = getRetryAfterMs(error);
      const delayMs = retryAfter ?? exponentialDelay;

      // Notify about retry
      if (onRetry) {
        onRetry(attempt, error, delayMs);
      }

      // Wait before retrying
      await sleep(delayMs);
    }
  }

  // All retries exhausted
  throw lastError;
}

/**
 * Format error message for user display
 */
export function formatErrorMessage(error: any): string {
  if (error instanceof TimeoutError) {
    return `⏱️  ${error.message}`;
  }

  if (error instanceof RetryableError) {
    return `🔄 ${error.message}`;
  }

  // Anthropic API errors
  if (error.error?.message) {
    return `API Error: ${error.error.message}`;
  }

  // Rate limit
  if (error.status === 429) {
    return 'Rate limit exceeded. Please wait before retrying.';
  }

  // Network errors
  if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND') {
    return `Network error: ${error.message}`;
  }

  // Generic error
  return error.message || String(error);
}

/**
 * Check if error is a rate limit error
 */
export function isRateLimitError(error: any): boolean {
  return error.status === 429 || error.error?.type === 'rate_limit_error';
}

/**
 * Check if error is a timeout error
 */
export function isTimeoutError(error: any): boolean {
  return error instanceof TimeoutError || error.code === 'ETIMEDOUT';
}
