/**
 * Google API Quota Error Handling
 * 
 * This code is copied from gemini-cli's proven implementation.
 * Original source: https://github.com/google-gemini/gemini-cli
 * 
 * @license
 * Original Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Files adapted:
 * - packages/core/src/utils/googleErrors.ts
 * - packages/core/src/utils/googleQuotaErrors.ts
 * - packages/core/src/utils/httpErrors.ts
 */

// ============================================================================
// Types from gemini-cli googleErrors.ts
// ============================================================================

export interface ErrorInfo {
  '@type': 'type.googleapis.com/google.rpc.ErrorInfo';
  reason: string;
  domain: string;
  metadata: { [key: string]: string };
}

export interface RetryInfo {
  '@type': 'type.googleapis.com/google.rpc.RetryInfo';
  retryDelay: string; // e.g. "51820.638305887s"
}

export interface DebugInfo {
  '@type': 'type.googleapis.com/google.rpc.DebugInfo';
  stackEntries: string[];
  detail: string;
}

export interface QuotaFailure {
  '@type': 'type.googleapis.com/google.rpc.QuotaFailure';
  violations: Array<{
    subject?: string;
    description?: string;
    apiService?: string;
    quotaMetric?: string;
    quotaId?: string;
    quotaDimensions?: { [key: string]: string };
    quotaValue?: string | number;
    futureQuotaValue?: number;
  }>;
}

export interface PreconditionFailure {
  '@type': 'type.googleapis.com/google.rpc.PreconditionFailure';
  violations: Array<{
    type: string;
    subject: string;
    description: string;
  }>;
}

export interface LocalizedMessage {
  '@type': 'type.googleapis.com/google.rpc.LocalizedMessage';
  locale: string;
  message: string;
}

export interface BadRequest {
  '@type': 'type.googleapis.com/google.rpc.BadRequest';
  fieldViolations: Array<{
    field: string;
    description: string;
    reason?: string;
    localizedMessage?: LocalizedMessage;
  }>;
}

export interface RequestInfo {
  '@type': 'type.googleapis.com/google.rpc.RequestInfo';
  requestId: string;
  servingData: string;
}

export interface ResourceInfo {
  '@type': 'type.googleapis.com/google.rpc.ResourceInfo';
  resourceType: string;
  resourceName: string;
  owner: string;
  description: string;
}

export interface Help {
  '@type': 'type.googleapis.com/google.rpc.Help';
  links: Array<{
    description: string;
    url: string;
  }>;
}

export type GoogleApiErrorDetail =
  | ErrorInfo
  | RetryInfo
  | DebugInfo
  | QuotaFailure
  | PreconditionFailure
  | BadRequest
  | RequestInfo
  | ResourceInfo
  | Help
  | LocalizedMessage;

export interface GoogleApiError {
  code: number;
  message: string;
  details: GoogleApiErrorDetail[];
}

type ErrorShape = {
  message?: string;
  details?: unknown[];
  code?: number;
};

// ============================================================================
// Error Classes from gemini-cli googleQuotaErrors.ts
// ============================================================================

/**
 * A non-retryable error indicating a hard quota limit has been reached (e.g., daily limit).
 */
export class TerminalQuotaError extends Error {
  retryDelayMs?: number;

  constructor(
    message: string,
    override readonly cause: GoogleApiError,
    retryDelaySeconds?: number,
  ) {
    super(message);
    this.name = 'TerminalQuotaError';
    this.retryDelayMs = retryDelaySeconds
      ? retryDelaySeconds * 1000
      : undefined;
  }
}

/**
 * A retryable error indicating a temporary quota issue (e.g., per-minute limit).
 */
export class RetryableQuotaError extends Error {
  retryDelayMs?: number;

  constructor(
    message: string,
    override readonly cause: GoogleApiError,
    retryDelaySeconds?: number,
  ) {
    super(message);
    this.name = 'RetryableQuotaError';
    this.retryDelayMs = retryDelaySeconds
      ? retryDelaySeconds * 1000
      : undefined;
  }
}

/**
 * Error for model not found (404)
 */
export class ModelNotFoundError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ModelNotFoundError';
  }
}

// ============================================================================
// Error Parsing from gemini-cli googleErrors.ts
// EXACT COPY - handles gaxios errors, nested JSON errors, etc.
// ============================================================================

function fromGaxiosError(errorObj: object): ErrorShape | undefined {
  const gaxiosError = errorObj as {
    response?: {
      status?: number;
      data?:
        | {
            error?: ErrorShape;
          }
        | string;
    };
    error?: ErrorShape;
    code?: number;
  };

  let outerError: ErrorShape | undefined;
  if (gaxiosError.response?.data) {
    let data = gaxiosError.response.data;

    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (_) {
        // Not a JSON string, can't parse.
      }
    }

    if (Array.isArray(data) && data.length > 0) {
      data = data[0];
    }

    if (typeof data === 'object' && data !== null) {
      if ('error' in data) {
        outerError = (data as { error: ErrorShape }).error;
      }
    }
  }

  if (!outerError) {
    // If the gaxios structure isn't there, check for a top-level `error` property.
    if (gaxiosError.error) {
      outerError = gaxiosError.error;
    } else {
      return undefined;
    }
  }
  return outerError;
}

function fromApiError(errorObj: object): ErrorShape | undefined {
  const apiError = errorObj as {
    message?:
      | {
          error?: ErrorShape;
        }
      | string;
    code?: number;
  };

  let outerError: ErrorShape | undefined;
  if (apiError.message) {
    let data = apiError.message;

    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (_) {
        // Not a JSON string, can't parse.
        // Try one more fallback: look for the first '{' and last '}'
        if (typeof data === 'string') {
          const firstBrace = data.indexOf('{');
          const lastBrace = data.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            try {
              data = JSON.parse(data.substring(firstBrace, lastBrace + 1));
            } catch (__) {
              // Still failed
            }
          }
        }
      }
    }

    if (Array.isArray(data) && data.length > 0) {
      data = data[0];
    }

    if (typeof data === 'object' && data !== null) {
      if ('error' in data) {
        outerError = (data as { error: ErrorShape }).error;
      }
    }
  }
  return outerError;
}

/**
 * Parses an error object to check if it's a structured Google API error
 * and extracts all details.
 *
 * This function can handle two formats:
 * 1. Standard Google API errors where `details` is a top-level field.
 * 2. Errors where the entire structured error object is stringified inside
 *    the `message` field of a wrapper error.
 *
 * EXACT COPY from gemini-cli parseGoogleApiError
 */
export function parseGoogleApiError(error: unknown): GoogleApiError | null {
  if (!error) {
    return null;
  }

  let errorObj: unknown = error;

  // If error is a string, try to parse it.
  if (typeof errorObj === 'string') {
    try {
      errorObj = JSON.parse(errorObj);
    } catch (_) {
      // Not a JSON string, can't parse.
      return null;
    }
  }

  if (Array.isArray(errorObj) && errorObj.length > 0) {
    errorObj = errorObj[0];
  }

  if (typeof errorObj !== 'object' || errorObj === null) {
    return null;
  }

  let currentError: ErrorShape | undefined =
    fromGaxiosError(errorObj) ?? fromApiError(errorObj);

  let depth = 0;
  const maxDepth = 10;
  // Handle cases where the actual error object is stringified inside the message
  // by drilling down until we find an error that doesn't have a stringified message.
  while (
    currentError &&
    typeof currentError.message === 'string' &&
    depth < maxDepth
  ) {
    try {
      const parsedMessage = JSON.parse(
        currentError.message.replace(/\u00A0/g, '').replace(/\n/g, ' '),
      );
      if (parsedMessage.error) {
        currentError = parsedMessage.error;
        depth++;
      } else {
        // The message is a JSON string, but not a nested error object.
        break;
      }
    } catch (_error) {
      // It wasn't a JSON string, so we've drilled down as far as we can.
      break;
    }
  }

  if (!currentError) {
    return null;
  }

  const code = currentError.code;
  const message = currentError.message;
  const errorDetails = currentError.details;

  if (code && message) {
    const details: GoogleApiErrorDetail[] = [];
    if (Array.isArray(errorDetails)) {
      for (const detail of errorDetails) {
        if (detail && typeof detail === 'object') {
          const detailObj = detail as Record<string, unknown>;
          const typeKey = Object.keys(detailObj).find(
            (key) => key.trim() === '@type',
          );
          if (typeKey) {
            if (typeKey !== '@type') {
              detailObj['@type'] = detailObj[typeKey];
              delete detailObj[typeKey];
            }
            // We can just cast it; the consumer will have to switch on @type
            details.push(detailObj as unknown as GoogleApiErrorDetail);
          }
        }
      }
    }

    return {
      code,
      message,
      details,
    };
  }

  return null;
}

// ============================================================================
// HTTP Error Utilities from gemini-cli httpErrors.ts
// ============================================================================

/**
 * Get HTTP status from various error shapes
 */
export function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null) {
    // Direct status property
    if ('status' in error && typeof (error as any).status === 'number') {
      return (error as any).status;
    }
    // Gaxios/axios style: error.response.status
    if ('response' in error) {
      const response = (error as any).response;
      if (response && typeof response === 'object' && 'status' in response) {
        return response.status;
      }
    }
    // Google API error style: error.code
    if ('code' in error && typeof (error as any).code === 'number') {
      return (error as any).code;
    }
  }
  return undefined;
}

// ============================================================================
// Error Classification from gemini-cli googleQuotaErrors.ts
// EXACT COPY - classifies 429 errors into terminal vs retryable
// ============================================================================

/**
 * Parses a duration string (e.g., "34.074824224s", "60s", "900ms") and returns the time in seconds.
 */
function parseDurationInSeconds(duration: string): number | null {
  if (duration.endsWith('ms')) {
    const milliseconds = parseFloat(duration.slice(0, -2));
    return isNaN(milliseconds) ? null : milliseconds / 1000;
  }
  if (duration.endsWith('s')) {
    const seconds = parseFloat(duration.slice(0, -1));
    return isNaN(seconds) ? null : seconds;
  }
  return null;
}

/**
 * Analyzes a caught error and classifies it as a specific quota-related error if applicable.
 *
 * It decides whether an error is a `TerminalQuotaError` or a `RetryableQuotaError` based on
 * the following logic:
 * - If the error indicates a daily limit, it's a `TerminalQuotaError`.
 * - If the error suggests a retry delay of more than 2 minutes, it's a `TerminalQuotaError`.
 * - If the error suggests a retry delay of 2 minutes or less, it's a `RetryableQuotaError`.
 * - If the error indicates a per-minute limit, it's a `RetryableQuotaError`.
 * - If the error message contains the phrase "Please retry in X[s|ms]", it's a `RetryableQuotaError`.
 *
 * EXACT COPY from gemini-cli classifyGoogleError
 */
export function classifyGoogleError(error: unknown): unknown {
  const googleApiError = parseGoogleApiError(error);
  const status = googleApiError?.code ?? getErrorStatus(error);

  if (status === 404) {
    const message =
      googleApiError?.message ||
      (error instanceof Error ? error.message : 'Model not found');
    return new ModelNotFoundError(message, status);
  }

  if (
    !googleApiError ||
    googleApiError.code !== 429 ||
    googleApiError.details.length === 0
  ) {
    // Fallback: try to parse the error message for a retry delay
    const errorMessage =
      googleApiError?.message ||
      (error instanceof Error ? error.message : String(error));
    const match = errorMessage.match(/Please retry in ([0-9.]+(?:ms|s))/);
    if (match?.[1]) {
      const retryDelaySeconds = parseDurationInSeconds(match[1]);
      if (retryDelaySeconds !== null) {
        return new RetryableQuotaError(
          errorMessage,
          googleApiError ?? {
            code: 429,
            message: errorMessage,
            details: [],
          },
          retryDelaySeconds,
        );
      }
    } else if (status === 429) {
      // Fallback: If it is a 429 but doesn't have a specific "retry in" message,
      // assume it is a temporary rate limit and retry after 5 sec (same as DEFAULT_RETRY_OPTIONS).
      return new RetryableQuotaError(
        errorMessage,
        googleApiError ?? {
          code: 429,
          message: errorMessage,
          details: [],
        },
      );
    }

    return error; // Not a 429 error we can handle with structured details or a parsable retry message.
  }

  const quotaFailure = googleApiError.details.find(
    (d): d is QuotaFailure =>
      d['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure',
  );

  const errorInfo = googleApiError.details.find(
    (d): d is ErrorInfo =>
      d['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo',
  );

  const retryInfo = googleApiError.details.find(
    (d): d is RetryInfo =>
      d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo',
  );

  // 1. Check for long-term limits in QuotaFailure or ErrorInfo
  if (quotaFailure) {
    for (const violation of quotaFailure.violations) {
      const quotaId = violation.quotaId ?? '';
      if (quotaId.includes('PerDay') || quotaId.includes('Daily')) {
        return new TerminalQuotaError(
          `You have exhausted your daily quota on this model.`,
          googleApiError,
        );
      }
    }
  }
  let delaySeconds;

  if (retryInfo?.retryDelay) {
    const parsedDelay = parseDurationInSeconds(retryInfo.retryDelay);
    if (parsedDelay) {
      delaySeconds = parsedDelay;
    }
  }

  if (errorInfo) {
    // New Cloud Code API quota handling
    if (errorInfo.domain) {
      const validDomains = [
        'cloudcode-pa.googleapis.com',
        'staging-cloudcode-pa.googleapis.com',
        'autopush-cloudcode-pa.googleapis.com',
      ];
      if (validDomains.includes(errorInfo.domain)) {
        if (errorInfo.reason === 'RATE_LIMIT_EXCEEDED') {
          return new RetryableQuotaError(
            `${googleApiError.message}`,
            googleApiError,
            delaySeconds ?? 10,
          );
        }
        if (errorInfo.reason === 'QUOTA_EXHAUSTED') {
          return new TerminalQuotaError(
            `${googleApiError.message}`,
            googleApiError,
            delaySeconds,
          );
        }
      }
    }

    // Existing Cloud Code API quota handling
    const quotaLimit = errorInfo.metadata?.['quota_limit'] ?? '';
    if (quotaLimit.includes('PerDay') || quotaLimit.includes('Daily')) {
      return new TerminalQuotaError(
        `You have exhausted your daily quota on this model.`,
        googleApiError,
      );
    }
  }

  // 2. Check for long delays in RetryInfo
  if (retryInfo?.retryDelay) {
    if (delaySeconds) {
      if (delaySeconds > 120) {
        return new TerminalQuotaError(
          `${googleApiError.message}\nSuggested retry after ${retryInfo.retryDelay}.`,
          googleApiError,
          delaySeconds,
        );
      }
      // This is a retryable error with a specific delay.
      return new RetryableQuotaError(
        `${googleApiError.message}\nSuggested retry after ${retryInfo.retryDelay}.`,
        googleApiError,
        delaySeconds,
      );
    }
  }

  // 3. Check for short-term limits in QuotaFailure or ErrorInfo
  if (quotaFailure) {
    for (const violation of quotaFailure.violations) {
      const quotaId = violation.quotaId ?? '';
      if (quotaId.includes('PerMinute')) {
        return new RetryableQuotaError(
          `${googleApiError.message}\nSuggested retry after 60s.`,
          googleApiError,
          60,
        );
      }
    }
  }

  if (errorInfo) {
    const quotaLimit = errorInfo.metadata?.['quota_limit'] ?? '';
    if (quotaLimit.includes('PerMinute')) {
      return new RetryableQuotaError(
        `${errorInfo.reason}\nSuggested retry after 60s.`,
        googleApiError,
        60,
      );
    }
  }

  // If we reached this point and the status is still 429, we return retryable.
  if (status === 429) {
    const errorMessage =
      googleApiError?.message ||
      (error instanceof Error ? error.message : String(error));
    return new RetryableQuotaError(
      errorMessage,
      googleApiError ?? {
        code: 429,
        message: errorMessage,
        details: [],
      },
    );
  }
  return error; // Fallback to original error if no specific classification fits.
}