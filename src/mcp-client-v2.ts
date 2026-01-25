/**
 * MCP Client V2 - Using official @modelcontextprotocol/sdk
 * Supports stdio, SSE, and HTTP transports with OAuth
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { EventEmitter } from 'events';
import {
  MCPServerConfig,
  MCPServerStatus,
  MCPServerState,
  MCPTool,
  MCPCallToolRequest,
  MCPCallToolResponse,
  MCPResource,
  MCPResourceTemplate,
  MCPResourceContents,
  MCPPrompt,
  MCPPromptMessage,
  MCPServerCapabilities,
} from './mcp-types.js';
import { SimpleMCPOAuthProvider } from './oauth-provider.js';

/**
 * MCP Client using official SDK
 * Supports multiple transports: stdio, SSE, HTTP
 */
export class MCPClientV2 extends EventEmitter {
  private client: Client | null = null;
  private transport: Transport | null = null;
  private status: MCPServerStatus = MCPServerStatus.DISCONNECTED;
  private discoveredTools: MCPTool[] = [];
  private discoveredResources: MCPResource[] = [];
  private discoveredPrompts: MCPPrompt[] = [];
  private serverCapabilities?: MCPServerCapabilities;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectDelayMs = 2000;
  private isReconnecting = false;

  constructor(private name: string, private config: MCPServerConfig) {
    super();
  }

  async connect(): Promise<void> {
    if (this.status !== MCPServerStatus.DISCONNECTED) {
      throw new Error('Client must be disconnected before connecting');
    }

    this.status = MCPServerStatus.CONNECTING;
    this.emit('statusChange', this.status);

    try {
      // Create transport based on config
      this.transport = await this.createTransport();

      // Create client with transport
      this.client = new Client(
        {
          name: 'agentic-cli',
          version: '0.1.0',
        },
        {
          capabilities: {},
        }
      );

      // Setup event handlers
      this.client.onerror = (error) => {
        this.emit('error', error);
      };

      this.client.onclose = () => {
        this.status = MCPServerStatus.DISCONNECTED;
        this.emit('statusChange', this.status);
        this.emit('disconnected');

        // Attempt automatic reconnection for SSE/HTTP transports
        if (!this.isReconnecting && (this.config.url || this.config.httpUrl)) {
          this.attemptReconnect();
        }
      };

      // Connect to server
      const initResult = await this.client.connect(this.transport);

      // Store server capabilities
      this.serverCapabilities = (initResult as any)?.serverInfo?.capabilities as MCPServerCapabilities;

      this.status = MCPServerStatus.CONNECTED;
      this.emit('statusChange', this.status);
    } catch (error) {
      this.status = MCPServerStatus.DISCONNECTED;
      this.emit('statusChange', this.status);
      throw error;
    }
  }

  /**
   * Create appropriate transport based on configuration
   */
  private async createTransport(): Promise<Transport> {
    // Create OAuth provider if OAuth is enabled
    let authProvider: SimpleMCPOAuthProvider | undefined;
    if (this.config.oauth?.enabled) {
      authProvider = new SimpleMCPOAuthProvider(
        this.name,
        this.config.oauth.redirectPort || 3000
      );
    }

    // SSE transport (URL with /sse)
    if (this.config.url && this.config.url.includes('/sse')) {
      const url = new URL(this.config.url);
      return new SSEClientTransport(url, {
        authProvider,
        fetch: fetch,
      });
    }

    // HTTP transport (any other URL)
    if (this.config.url || this.config.httpUrl) {
      const url = new URL(this.config.url || this.config.httpUrl!);
      return new StreamableHTTPClientTransport(url, {
        authProvider,
        fetch: fetch,
      });
    }

    // Stdio transport (command-based)
    if (this.config.command) {
      // Filter out undefined values from env
      const env = this.config.env
        ? Object.fromEntries(
            Object.entries({ ...process.env, ...this.config.env }).filter(
              ([_, v]) => v !== undefined
            ) as [string, string][]
          )
        : undefined;

      return new StdioClientTransport({
        command: this.config.command,
        args: this.config.args || [],
        env,
      });
    }

    throw new Error(
      'Invalid MCP config: must specify either url/httpUrl (for SSE/HTTP) or command (for stdio)'
    );
  }

  async discoverTools(): Promise<MCPTool[]> {
    if (!this.client || this.status !== MCPServerStatus.CONNECTED) {
      throw new Error('Client not connected');
    }

    try {
      const response = await this.client.listTools();

      // Convert SDK tool format to our format
      this.discoveredTools = (response.tools || []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as MCPTool['inputSchema'],
      }));

      // Apply tool filtering
      let filteredTools = this.discoveredTools;

      if (
        this.config.includeTools &&
        this.config.includeTools.length > 0
      ) {
        filteredTools = filteredTools.filter((tool) =>
          this.config.includeTools!.includes(tool.name)
        );
      }

      if (
        this.config.excludeTools &&
        this.config.excludeTools.length > 0
      ) {
        filteredTools = filteredTools.filter(
          (tool) => !this.config.excludeTools!.includes(tool.name)
        );
      }

      return filteredTools;
    } catch (error) {
      throw new Error(
        `Failed to discover tools: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async callTool(
    request: MCPCallToolRequest
  ): Promise<MCPCallToolResponse> {
    if (!this.client || this.status !== MCPServerStatus.CONNECTED) {
      throw new Error('Client not connected');
    }

    try {
      const response = await this.client.callTool({
        name: request.name,
        arguments: request.arguments,
      });

      return {
        content: response.content as MCPCallToolResponse['content'],
        isError: response.isError as boolean | undefined,
      };
    } catch (error) {
      throw new Error(
        `Failed to call tool ${request.name}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * List available resources
   */
  async listResources(): Promise<MCPResource[]> {
    if (!this.client || this.status !== MCPServerStatus.CONNECTED) {
      throw new Error('Client not connected');
    }

    try {
      const response = await this.client.listResources();
      this.discoveredResources = (response.resources || []).map((resource) => ({
        uri: resource.uri,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
        annotations: resource.annotations as MCPResource['annotations'],
      }));
      return this.discoveredResources;
    } catch (error) {
      throw new Error(
        `Failed to list resources: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * List resource templates (for dynamic resources)
   */
  async listResourceTemplates(): Promise<MCPResourceTemplate[]> {
    if (!this.client || this.status !== MCPServerStatus.CONNECTED) {
      throw new Error('Client not connected');
    }

    try {
      const response = await this.client.listResourceTemplates();
      return (response.resourceTemplates || []).map((template) => ({
        uriTemplate: template.uriTemplate,
        name: template.name,
        description: template.description,
        mimeType: template.mimeType,
      }));
    } catch (error) {
      throw new Error(
        `Failed to list resource templates: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Read a specific resource by URI
   */
  async readResource(uri: string): Promise<MCPResourceContents[]> {
    if (!this.client || this.status !== MCPServerStatus.CONNECTED) {
      throw new Error('Client not connected');
    }

    try {
      const response = await this.client.readResource({ uri });
      return (response.contents || []).map((content: any) => ({
        uri: content.uri,
        mimeType: content.mimeType,
        text: content.text,
        blob: content.blob,
      }));
    } catch (error) {
      throw new Error(
        `Failed to read resource ${uri}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Subscribe to resource updates
   */
  async subscribeResource(uri: string): Promise<void> {
    if (!this.client || this.status !== MCPServerStatus.CONNECTED) {
      throw new Error('Client not connected');
    }

    if (!this.serverCapabilities?.resources?.subscribe) {
      throw new Error('Server does not support resource subscriptions');
    }

    try {
      await this.client.subscribeResource({ uri });
    } catch (error) {
      throw new Error(
        `Failed to subscribe to resource ${uri}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Unsubscribe from resource updates
   */
  async unsubscribeResource(uri: string): Promise<void> {
    if (!this.client || this.status !== MCPServerStatus.CONNECTED) {
      throw new Error('Client not connected');
    }

    if (!this.serverCapabilities?.resources?.subscribe) {
      throw new Error('Server does not support resource subscriptions');
    }

    try {
      await this.client.unsubscribeResource({ uri });
    } catch (error) {
      throw new Error(
        `Failed to unsubscribe from resource ${uri}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * List available prompts
   */
  async listPrompts(): Promise<MCPPrompt[]> {
    if (!this.client || this.status !== MCPServerStatus.CONNECTED) {
      throw new Error('Client not connected');
    }

    try {
      const response = await this.client.listPrompts();
      this.discoveredPrompts = (response.prompts || []).map((prompt) => ({
        name: prompt.name,
        description: prompt.description,
        arguments: prompt.arguments,
      }));
      return this.discoveredPrompts;
    } catch (error) {
      throw new Error(
        `Failed to list prompts: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get a prompt with arguments
   */
  async getPrompt(
    name: string,
    args?: Record<string, string>
  ): Promise<{ messages: MCPPromptMessage[]; description?: string }> {
    if (!this.client || this.status !== MCPServerStatus.CONNECTED) {
      throw new Error('Client not connected');
    }

    try {
      const response = await this.client.getPrompt({
        name,
        arguments: args,
      });

      // Convert SDK prompt messages to our format
      const messages: MCPPromptMessage[] = (response.messages || []).map(
        (msg) => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content as MCPPromptMessage['content'],
        })
      );

      return {
        messages,
        description: response.description,
      };
    } catch (error) {
      throw new Error(
        `Failed to get prompt ${name}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Attempt to reconnect after connection loss
   */
  private async attemptReconnect(): Promise<void> {
    if (this.isReconnecting || this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    // Wait before reconnecting
    await new Promise(resolve => setTimeout(resolve, this.reconnectDelayMs));

    try {
      // Clean up old connection
      this.client = null;
      this.transport = null;

      // Reconnect
      await this.connect();

      // Re-discover tools
      await this.discoverTools();

      this.reconnectAttempts = 0;
      this.emit('reconnected');
    } catch (error) {
      // Silently fail - will retry on next disconnect or user can manually reconnect
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        // Try again
        this.isReconnecting = false;
        this.attemptReconnect();
      }
    } finally {
      this.isReconnecting = false;
    }
  }

  disconnect(): void {
    // Prevent reconnection when intentionally disconnecting
    this.reconnectAttempts = this.maxReconnectAttempts;

    if (this.client) {
      this.client.close().catch((error) => {
        console.error('Error closing client:', error);
      });
      this.client = null;
    }

    if (this.transport) {
      this.transport.close().catch((error) => {
        console.error('Error closing transport:', error);
      });
      this.transport = null;
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

  getResources(): MCPResource[] {
    return this.discoveredResources;
  }

  getPrompts(): MCPPrompt[] {
    return this.discoveredPrompts;
  }

  getCapabilities(): MCPServerCapabilities | undefined {
    return this.serverCapabilities;
  }

  getState(): MCPServerState {
    return {
      name: this.name,
      config: this.config,
      status: this.status,
      tools: this.discoveredTools,
      resources: this.discoveredResources,
      prompts: this.discoveredPrompts,
      capabilities: this.serverCapabilities,
    };
  }
}

/**
 * MCP Manager V2 - Manages multiple MCP servers using SDK
 */
export class MCPManagerV2 {
  private clients = new Map<string, MCPClientV2>();

  async addServer(name: string, config: MCPServerConfig): Promise<void> {
    if (this.clients.has(name)) {
      throw new Error(`MCP server '${name}' already exists`);
    }

    const client = new MCPClientV2(name, config);
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

  getServer(name: string): MCPClientV2 | undefined {
    return this.clients.get(name);
  }

  getAllServers(): MCPServerState[] {
    return Array.from(this.clients.values()).map((client) =>
      client.getState()
    );
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
