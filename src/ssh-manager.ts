/**
 * SSH Connection Manager
 * Manages SSH connections for remote command execution and file operations
 */

import { Client } from 'ssh2';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SSHConnection, SSHConnectionConfig, SSHCommandResult, SSHExecOptions } from './ssh-types.js';
import { sanitizeCommand, validatePath, validateSSHConfig } from './ssh-security.js';

class SSHManager {
  private connections: Map<string, SSHConnection> = new Map();
  private activeConnection: SSHConnection | null = null;
  private nextId: number = 1;

  /**
   * Connect to a remote SSH host
   */
  async connect(config: SSHConnectionConfig): Promise<string> {
    // Validate configuration
    validateSSHConfig(config);

    const id = `ssh_${this.nextId++}`;
    const client = new Client();

    const connection: SSHConnection = {
      id,
      config,
      client,
      status: 'connecting',
    };

    this.connections.set(id, connection);

    return new Promise((resolve, reject) => {
      const timeout = config.timeout || 30000;

      // Set connection timeout
      const timeoutHandle = setTimeout(() => {
        client.end();
        connection.status = 'error';
        connection.lastError = 'Connection timeout';
        reject(new Error(`Connection timeout after ${timeout}ms`));
      }, timeout);

      client.on('ready', () => {
        clearTimeout(timeoutHandle);
        connection.status = 'connected';
        connection.connectedAt = Date.now();
        this.activeConnection = connection;
        console.log(`✅ Connected to ${config.username}@${config.host}:${config.port}`);
        resolve(id);
      });

      client.on('error', (err) => {
        clearTimeout(timeoutHandle);
        connection.status = 'error';
        connection.lastError = err.message;
        this.connections.delete(id);

        // Provide helpful error messages
        if (err.message.includes('ECONNREFUSED')) {
          reject(new Error(`Connection refused: Cannot reach ${config.host}:${config.port}. Is SSH server running?`));
        } else if (err.message.includes('ENOTFOUND')) {
          reject(new Error(`Host not found: ${config.host}. Check hostname/IP address.`));
        } else if (err.message.includes('authentication')) {
          reject(new Error(`Authentication failed: Check username and credentials.`));
        } else {
          reject(new Error(`SSH connection error: ${err.message}`));
        }
      });

      client.on('close', () => {
        connection.status = 'disconnected';
        if (this.activeConnection?.id === id) {
          this.activeConnection = null;
        }
      });

      // Prepare connection options
      const connectOptions: any = {
        host: config.host,
        port: config.port,
        username: config.username,
        readyTimeout: timeout,
      };

      // Use private key if provided
      if (config.privateKeyPath) {
        fs.readFile(path.resolve(config.privateKeyPath), 'utf8')
          .then((privateKey) => {
            connectOptions.privateKey = privateKey;
            client.connect(connectOptions);
          })
          .catch((err) => {
            clearTimeout(timeoutHandle);
            reject(new Error(`Failed to read private key: ${err.message}`));
          });
      } else if (config.password) {
        // Use password authentication
        connectOptions.password = config.password;
        client.connect(connectOptions);
      } else {
        clearTimeout(timeoutHandle);
        reject(new Error('Either privateKeyPath or password is required'));
      }
    });
  }

  /**
   * Disconnect from a specific connection or the active connection
   */
  async disconnect(connectionId?: string): Promise<void> {
    const id = connectionId || this.activeConnection?.id;

    if (!id) {
      throw new Error('No active connection to disconnect');
    }

    const connection = this.connections.get(id);
    if (!connection) {
      throw new Error(`Connection not found: ${id}`);
    }

    return new Promise((resolve) => {
      connection.client.once('close', () => {
        this.connections.delete(id);
        if (this.activeConnection?.id === id) {
          this.activeConnection = null;
        }
        console.log(`✅ Disconnected from ${connection.config.username}@${connection.config.host}`);
        resolve();
      });

      connection.client.end();
      connection.status = 'disconnected';
    });
  }

  /**
   * Execute a command on the remote host
   */
  async executeCommand(
    command: string,
    options: SSHExecOptions = {}
  ): Promise<SSHCommandResult> {
    const connection = this.activeConnection;

    if (!connection || connection.status !== 'connected') {
      throw new Error('No active SSH connection. Use /remote connect first.');
    }

    // Sanitize command
    sanitizeCommand(command);

    const timeout = options.timeout || 30000;
    const startTime = Date.now();

    // Prepare command with cwd and env
    let fullCommand = command;

    if (options.cwd) {
      validatePath(options.cwd);
      fullCommand = `cd ${options.cwd} && ${command}`;
    }

    if (options.env && Object.keys(options.env).length > 0) {
      const envVars = Object.entries(options.env)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ');
      fullCommand = `env ${envVars} ${fullCommand}`;
    }

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const timeoutHandle = setTimeout(() => {
        reject(new Error(`Command execution timeout after ${timeout}ms`));
      }, timeout);

      connection.client.exec(fullCommand, (err, stream) => {
        if (err) {
          clearTimeout(timeoutHandle);
          reject(new Error(`Failed to execute command: ${err.message}`));
          return;
        }

        // Pipe stdin if provided
        if (options.stdin) {
          stream.write(options.stdin);
          stream.end();
        }

        stream.on('close', (code: number) => {
          clearTimeout(timeoutHandle);
          const duration = Date.now() - startTime;

          resolve({
            stdout,
            stderr,
            exitCode: code || 0,
            duration,
          });
        });

        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
      });
    });
  }

  /**
   * Read a remote file using SFTP
   */
  async readFile(remotePath: string): Promise<Buffer> {
    const connection = this.activeConnection;

    if (!connection || connection.status !== 'connected') {
      throw new Error('No active SSH connection. Use /remote connect first.');
    }

    validatePath(remotePath);

    return new Promise((resolve, reject) => {
      connection.client.sftp((err, sftp) => {
        if (err) {
          reject(new Error(`SFTP error: ${err.message}`));
          return;
        }

        sftp.readFile(remotePath, (err, data) => {
          sftp.end();

          if (err) {
            if (err.message.includes('No such file')) {
              reject(new Error(`File not found: ${remotePath}`));
            } else if (err.message.includes('Permission denied')) {
              reject(new Error(`Permission denied: ${remotePath}`));
            } else {
              reject(new Error(`Failed to read file: ${err.message}`));
            }
          } else {
            resolve(data);
          }
        });
      });
    });
  }

  /**
   * Write a remote file using SFTP
   */
  async writeFile(remotePath: string, content: Buffer | string): Promise<void> {
    const connection = this.activeConnection;

    if (!connection || connection.status !== 'connected') {
      throw new Error('No active SSH connection. Use /remote connect first.');
    }

    validatePath(remotePath);

    const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;

    return new Promise((resolve, reject) => {
      connection.client.sftp((err, sftp) => {
        if (err) {
          reject(new Error(`SFTP error: ${err.message}`));
          return;
        }

        sftp.writeFile(remotePath, buffer, (err) => {
          sftp.end();

          if (err) {
            if (err.message.includes('Permission denied')) {
              reject(new Error(`Permission denied: ${remotePath}`));
            } else {
              reject(new Error(`Failed to write file: ${err.message}`));
            }
          } else {
            resolve();
          }
        });
      });
    });
  }

  /**
   * Check if a remote file exists
   */
  async fileExists(remotePath: string): Promise<boolean> {
    try {
      await this.executeCommand(`test -f ${remotePath}`, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List remote directory contents
   */
  async listDirectory(remotePath: string): Promise<string[]> {
    validatePath(remotePath);

    const result = await this.executeCommand(`ls -1 ${remotePath}`);

    if (result.exitCode !== 0) {
      throw new Error(`Failed to list directory: ${result.stderr}`);
    }

    return result.stdout.trim().split('\n').filter((f) => f.length > 0);
  }

  /**
   * Get the active connection
   */
  getActiveConnection(): SSHConnection | null {
    return this.activeConnection;
  }

  /**
   * Get all connections
   */
  getAllConnections(): SSHConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.activeConnection?.status === 'connected';
  }

  /**
   * Get connection status
   */
  getStatus(): string {
    if (!this.activeConnection) {
      return 'Not connected';
    }

    const { config, status, connectedAt } = this.activeConnection;
    const uptime = connectedAt ? Math.floor((Date.now() - connectedAt) / 1000) : 0;

    return `${status === 'connected' ? '🟢' : '🔴'} ${config.username}@${config.host}:${config.port} (${status}, uptime: ${uptime}s)`;
  }
}

// Global singleton instance
export const sshManager = new SSHManager();
