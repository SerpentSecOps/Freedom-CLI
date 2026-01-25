/**
 * LSP Manager - manages multiple LSP servers
 */

import { extname } from 'path';
import { LSPClient } from './lsp-client.js';
import type { LSPServerConfig } from './lsp-types.js';

/**
 * Registered LSP server information
 */
interface RegisteredServer {
  name: string;
  config: LSPServerConfig;
  client: LSPClient | null;
  extensions: string[]; // File extensions this server handles
}

/**
 * LSP Manager class
 */
export class LSPManager {
  private servers: Map<string, RegisteredServer> = new Map();
  private extensionMap: Map<string, string> = new Map(); // extension -> server name
  private rootPath: string;

  constructor(rootPath?: string) {
    this.rootPath = rootPath || process.cwd();
  }

  /**
   * Register an LSP server
   */
  async registerServer(name: string, config: LSPServerConfig): Promise<void> {
    if (this.servers.has(name)) {
      console.warn(`LSP server '${name}' is already registered`);
      return;
    }

    const extensions: string[] = [];

    // Build extension list from config
    if (config.extensionToLanguage) {
      for (const ext of Object.keys(config.extensionToLanguage)) {
        const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
        extensions.push(normalizedExt);
        this.extensionMap.set(normalizedExt, name);
      }
    }

    this.servers.set(name, {
      name,
      config,
      client: null,
      extensions,
    });
  }

  /**
   * Start an LSP server
   */
  async startServer(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) {
      throw new Error(`LSP server '${name}' not registered`);
    }

    if (server.client) {
      console.warn(`LSP server '${name}' is already started`);
      return;
    }

    try {
      const client = new LSPClient(server.config);
      await client.start();
      await client.initialize(this.rootPath);

      server.client = client;
    } catch (error: any) {
      throw new Error(`Failed to start LSP server '${name}': ${error.message}`);
    }
  }

  /**
   * Stop an LSP server
   */
  async stopServer(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server || !server.client) {
      return;
    }

    await server.client.shutdown();
    server.client = null;
  }

  /**
   * Start all registered servers
   */
  async startAllServers(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [name, _] of this.servers) {
      promises.push(
        this.startServer(name).catch((error) => {
          console.error(`Failed to start LSP server '${name}':`, error.message);
        })
      );
    }

    await Promise.all(promises);
  }

  /**
   * Stop all running servers
   */
  async stopAllServers(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [name, server] of this.servers) {
      if (server.client) {
        promises.push(this.stopServer(name));
      }
    }

    await Promise.all(promises);
  }

  /**
   * Get LSP client for a file
   */
  getClientForFile(filePath: string): LSPClient | null {
    const ext = extname(filePath);
    const serverName = this.extensionMap.get(ext);

    if (!serverName) {
      return null;
    }

    const server = this.servers.get(serverName);
    if (!server || !server.client) {
      return null;
    }

    return server.client;
  }

  /**
   * Get LSP client by server name
   */
  getClient(name: string): LSPClient | null {
    const server = this.servers.get(name);
    return server?.client || null;
  }

  /**
   * Get all registered server names
   */
  getServerNames(): string[] {
    return Array.from(this.servers.keys());
  }

  /**
   * Get server info
   */
  getServerInfo(name: string): RegisteredServer | undefined {
    return this.servers.get(name);
  }

  /**
   * Check if a server is registered
   */
  hasServer(name: string): boolean {
    return this.servers.has(name);
  }

  /**
   * Check if a file extension has an LSP server
   */
  hasServerForExtension(extension: string): boolean {
    const normalizedExt = extension.startsWith('.') ? extension : `.${extension}`;
    return this.extensionMap.has(normalizedExt);
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalServers: number;
    runningServers: number;
    supportedExtensions: number;
  } {
    let runningServers = 0;

    for (const server of this.servers.values()) {
      if (server.client && server.client.isReady()) {
        runningServers++;
      }
    }

    return {
      totalServers: this.servers.size,
      runningServers,
      supportedExtensions: this.extensionMap.size,
    };
  }

  /**
   * Unregister a server
   */
  async unregisterServer(name: string): Promise<void> {
    await this.stopServer(name);

    const server = this.servers.get(name);
    if (server) {
      // Remove extension mappings
      for (const ext of server.extensions) {
        this.extensionMap.delete(ext);
      }
      this.servers.delete(name);
    }
  }

  /**
   * Clear all servers
   */
  async clear(): Promise<void> {
    await this.stopAllServers();
    this.servers.clear();
    this.extensionMap.clear();
  }
}

/**
 * Global LSP manager instance
 */
export const lspManager = new LSPManager();
