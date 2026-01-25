/**
 * MCP (Model Context Protocol) Client
 * Connects to MCP servers via stdio and manages tool discovery/execution
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import {
  MCPServerConfig,
  MCPRequest,
  MCPResponse,
  MCPToolsListResponse,
  MCPCallToolRequest,
  MCPCallToolResponse,
  MCPServerStatus,
  MCPServerState,
  MCPTool,
} from './mcp-types.js';

export class MCPClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private buffer = '';
  private status: MCPServerStatus = MCPServerStatus.DISCONNECTED;
  private discoveredTools: MCPTool[] = [];

  constructor(
    private name: string,
    private config: MCPServerConfig
  ) {
    super();
  }

  async connect(): Promise<void> {
    if (!this.config.command) {
      throw new Error('MCP server must have a command (stdio transport only for now)');
    }

    this.status = MCPServerStatus.CONNECTING;
    this.emit('statusChange', this.status);

    return new Promise((resolve, reject) => {
      const timeout = this.config.timeout || 30000;
      const timer = setTimeout(() => {
        this.disconnect();
        reject(new Error(`MCP server connection timeout after ${timeout}ms`));
      }, timeout);

      try {
        this.process = spawn(this.config.command!, this.config.args || [], {
          cwd: this.config.cwd,
          env: { ...process.env, ...this.config.env },
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        this.process.on('error', (error) => {
          clearTimeout(timer);
          this.status = MCPServerStatus.DISCONNECTED;
          this.emit('statusChange', this.status);
          reject(new Error(`Failed to spawn MCP server: ${error.message}`));
        });

        this.process.on('exit', (code) => {
          this.status = MCPServerStatus.DISCONNECTED;
          this.emit('statusChange', this.status);
          this.emit('disconnected', code);
        });

        if (this.process.stdout) {
          this.process.stdout.on('data', (chunk: Buffer) => {
            this.handleOutput(chunk.toString());
          });
        }

        if (this.process.stderr) {
          this.process.stderr.on('data', (chunk: Buffer) => {
            // Log stderr but don't treat as error (many servers log INFO to stderr)
            const message = chunk.toString().trim();
            if (message && !message.includes('[INFO]')) {
              this.emit('stderr', message);
            }
          });
        }

        // Send initialize request
        this.sendRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'agentic-cli',
            version: '0.1.0',
          },
        })
          .then(() => {
            this.status = MCPServerStatus.CONNECTED;
            this.emit('statusChange', this.status);
            clearTimeout(timer);
            resolve();
          })
          .catch((error) => {
            clearTimeout(timer);
            this.disconnect();
            reject(error);
          });
      } catch (error) {
        clearTimeout(timer);
        this.status = MCPServerStatus.DISCONNECTED;
        this.emit('statusChange', this.status);
        reject(error);
      }
    });
  }

  async discoverTools(): Promise<MCPTool[]> {
    if (this.status !== MCPServerStatus.CONNECTED) {
      throw new Error('MCP server not connected');
    }

    const response = (await this.sendRequest('tools/list', {})) as MCPToolsListResponse;
    this.discoveredTools = response.tools || [];

    // Apply tool filtering
    let filteredTools = this.discoveredTools;

    if (this.config.includeTools && this.config.includeTools.length > 0) {
      filteredTools = filteredTools.filter((tool) => this.config.includeTools!.includes(tool.name));
    }

    if (this.config.excludeTools && this.config.excludeTools.length > 0) {
      filteredTools = filteredTools.filter((tool) => !this.config.excludeTools!.includes(tool.name));
    }

    return filteredTools;
  }

  async callTool(request: MCPCallToolRequest): Promise<MCPCallToolResponse> {
    if (this.status !== MCPServerStatus.CONNECTED) {
      throw new Error('MCP server not connected');
    }

    const response = (await this.sendRequest('tools/call', request)) as MCPCallToolResponse;
    return response;
  }

  disconnect(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.status = MCPServerStatus.DISCONNECTED;
    this.emit('statusChange', this.status);
  }

  getStatus(): MCPServerStatus {
    return this.status;
  }

  getTools(): MCPTool[] {
    return this.discoveredTools;
  }

  getState(): MCPServerState {
    return {
      name: this.name,
      config: this.config,
      status: this.status,
      tools: this.discoveredTools,
      resources: [],
      prompts: [],
    };
  }

  private async sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const request: MCPRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.pendingRequests.set(id, { resolve, reject });

      const message = JSON.stringify(request) + '\n';
      if (!this.process || !this.process.stdin) {
        reject(new Error('MCP server process not available'));
        return;
      }

      this.process.stdin.write(message, (error) => {
        if (error) {
          this.pendingRequests.delete(id);
          reject(new Error(`Failed to send request: ${error.message}`));
        }
      });
    });
  }

  private handleOutput(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const response: MCPResponse = JSON.parse(line);
        const pending = this.pendingRequests.get(response.id as number);

        if (pending) {
          this.pendingRequests.delete(response.id as number);

          if (response.error) {
            pending.reject(
              new Error(`MCP error ${response.error.code}: ${response.error.message}`)
            );
          } else {
            pending.resolve(response.result);
          }
        }
      } catch (error) {
        this.emit('parseError', { line, error });
      }
    }
  }
}

/**
 * MCP Manager - Manages multiple MCP servers
 */
export class MCPManager {
  private clients = new Map<string, MCPClient>();

  async addServer(name: string, config: MCPServerConfig): Promise<void> {
    if (this.clients.has(name)) {
      throw new Error(`MCP server '${name}' already exists`);
    }

    const client = new MCPClient(name, config);
    this.clients.set(name, client);

    try {
      await client.connect();
    } catch (error) {
      this.clients.delete(name);
      throw error;
    }
  }

  async removeServer(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (client) {
      client.disconnect();
      this.clients.delete(name);
    }
  }

  getServer(name: string): MCPClient | undefined {
    return this.clients.get(name);
  }

  getAllServers(): MCPServerState[] {
    return Array.from(this.clients.values()).map((client) => client.getState());
  }

  async discoverAllTools(): Promise<Map<string, MCPTool[]>> {
    const toolsByServer = new Map<string, MCPTool[]>();

    for (const [name, client] of this.clients.entries()) {
      try {
        const tools = await client.discoverTools();
        toolsByServer.set(name, tools);
      } catch (error) {
        console.error(`Failed to discover tools from ${name}:`, error);
        toolsByServer.set(name, []);
      }
    }

    return toolsByServer;
  }

  disconnectAll(): void {
    for (const client of this.clients.values()) {
      client.disconnect();
    }
    this.clients.clear();
  }
}
