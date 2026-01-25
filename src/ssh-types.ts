/**
 * TypeScript interfaces for SSH remote execution
 */

import { Client } from 'ssh2';

/**
 * SSH connection configuration
 */
export interface SSHConnectionConfig {
  /** Remote host address */
  host: string;
  /** SSH port (default: 22) */
  port: number;
  /** Username for authentication */
  username: string;
  /** Private key path for key-based auth */
  privateKeyPath?: string;
  /** Password for password-based auth */
  password?: string;
  /** Host key verification (default: true) */
  strictHostKeyChecking?: boolean;
  /** Connection timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/**
 * Active SSH connection
 */
export interface SSHConnection {
  /** Unique connection ID */
  id: string;
  /** Connection configuration */
  config: SSHConnectionConfig;
  /** ssh2 client instance */
  client: Client;
  /** Connection status */
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  /** Connection start time */
  connectedAt?: number;
  /** Last error (if any) */
  lastError?: string;
}

/**
 * Result of a remote command execution
 */
export interface SSHCommandResult {
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Exit code (0 = success) */
  exitCode: number;
  /** Execution duration in milliseconds */
  duration: number;
}

/**
 * Options for remote command execution
 */
export interface SSHExecOptions {
  /** Working directory for command */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Execution timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** stdin data to pipe to command */
  stdin?: string;
}

/**
 * Parsed SSH URI
 * Format: ssh://user@host:port or user@host:port
 */
export interface SSHUri {
  username: string;
  host: string;
  port: number;
}
