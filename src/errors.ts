/**
 * Custom error classes for Freedom CLI
 * Inspired by Gemini CLI's error handling patterns
 */

/**
 * Base error class with exit code
 */
export abstract class FreedomError extends Error {
  abstract exitCode: number;
  abstract errorType: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Fatal errors that require immediate termination
 */
export class FatalError extends FreedomError {
  exitCode = 1;
  errorType = 'FATAL_ERROR';
}

/**
 * Tool execution errors that prevent continued execution
 */
export class FatalToolExecutionError extends FatalError {
  exitCode = 2;
  errorType = 'FATAL_TOOL_ERROR';

  constructor(message: string, public toolName?: string) {
    super(message);
  }
}

/**
 * User cancelled operation via Ctrl+C or signal
 */
export class FatalCancellationError extends FatalError {
  exitCode = 130; // Standard Unix exit code for SIGINT
  errorType = 'FATAL_CANCELLATION';
}

/**
 * Maximum session turns exceeded
 */
export class FatalTurnLimitError extends FatalError {
  exitCode = 3;
  errorType = 'FATAL_TURN_LIMIT';
}

/**
 * Tool parameter validation error (non-fatal - model can retry)
 */
export class ToolParameterError extends Error {
  errorType = 'INVALID_TOOL_PARAMS';

  constructor(message: string, public toolName?: string) {
    super(message);
    this.name = 'ToolParameterError';
  }
}

/**
 * File/path not found error (non-fatal - model can retry)
 */
export class FileNotFoundError extends Error {
  errorType = 'FILE_NOT_FOUND';

  constructor(message: string, public path?: string) {
    super(message);
    this.name = 'FileNotFoundError';
  }
}

/**
 * Path not in workspace error (non-fatal - model can retry with correct path)
 */
export class PathNotInWorkspaceError extends Error {
  errorType = 'PATH_NOT_IN_WORKSPACE';

  constructor(message: string, public path?: string) {
    super(message);
    this.name = 'PathNotInWorkspaceError';
  }
}

/**
 * No disk space error (fatal - cannot continue)
 */
export class NoSpaceLeftError extends FatalToolExecutionError {
  errorType = 'NO_SPACE_LEFT';

  constructor(message: string) {
    super(message);
  }
}

/**
 * Permission denied error (fatal - cannot continue)
 */
export class PermissionDeniedError extends FatalToolExecutionError {
  errorType = 'PERMISSION_DENIED';

  constructor(message: string, public path?: string) {
    super(message);
  }
}

/**
 * Type guard to check if an error type is fatal
 */
export function isFatalErrorType(errorType?: string): boolean {
  const fatalTypes = [
    'NO_SPACE_LEFT',
    'PERMISSION_DENIED',
    'FATAL_ERROR',
    'FATAL_TOOL_ERROR',
    'FATAL_CANCELLATION',
    'FATAL_TURN_LIMIT',
  ];

  return errorType ? fatalTypes.includes(errorType) : false;
}

/**
 * Type guard to check if an error is fatal
 */
export function isFatalError(error: unknown): boolean {
  if (error instanceof FatalError) {
    return true;
  }

  // Check errorType property
  if (error && typeof error === 'object' && 'errorType' in error) {
    return isFatalErrorType((error as any).errorType);
  }

  return false;
}

/**
 * Extract error message from unknown error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Extract error type from unknown error
 */
export function getErrorType(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'errorType' in error) {
    return (error as any).errorType;
  }

  if (error instanceof Error) {
    return error.constructor.name;
  }

  return undefined;
}

/**
 * Extract exit code from error
 */
export function getExitCode(error: unknown): number {
  // Check for exitCode property
  if (error && typeof error === 'object' && 'exitCode' in error) {
    const exitCode = (error as any).exitCode;
    if (typeof exitCode === 'number') {
      return exitCode;
    }
  }

  // Check for code property (Node.js errors)
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as any).code;
    if (typeof code === 'number') {
      return code;
    }
  }

  // Default exit code
  return 1;
}

/**
 * Detect disk space errors from system error codes
 */
export function isDiskSpaceError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as any).code;
    return code === 'ENOSPC' || code === 'EDQUOT';
  }
  return false;
}

/**
 * Detect permission errors from system error codes
 */
export function isPermissionError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as any).code;
    return code === 'EACCES' || code === 'EPERM';
  }
  return false;
}

/**
 * Convert system errors to custom error classes
 */
export function convertSystemError(error: unknown, context?: string): Error {
  const message = getErrorMessage(error);

  // Disk space errors
  if (isDiskSpaceError(error)) {
    return new NoSpaceLeftError(context ? `${context}: ${message}` : message);
  }

  // Permission errors
  if (isPermissionError(error)) {
    return new PermissionDeniedError(context ? `${context}: ${message}` : message);
  }

  // File not found
  if (error && typeof error === 'object' && 'code' in error && (error as any).code === 'ENOENT') {
    const path = (error as any).path;
    return new FileNotFoundError(context ? `${context}: ${message}` : message, path);
  }

  // Return original error if not a known system error
  return error instanceof Error ? error : new Error(message);
}
