/**
 * Model Context Protocol (MCP) Type Definitions
 * Based on MCP specification: https://modelcontextprotocol.io/specification/2025-06-18
 */

// OAuth Configuration
export interface MCPOAuthConfig {
  enabled?: boolean;
  clientId?: string;
  clientSecret?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  redirectPort?: number;
}

// MCP Server Configuration
export interface MCPServerConfig {
  // Stdio transport (spawn process)
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;

  // HTTP transports
  url?: string; // SSE or HTTP endpoint
  httpUrl?: string; // HTTP streaming endpoint (alternative to url)
  headers?: Record<string, string>;

  // OAuth configuration
  oauth?: MCPOAuthConfig;

  // Common settings
  timeout?: number; // milliseconds
  trust?: boolean; // bypass confirmations
  includeTools?: string[]; // allowlist
  excludeTools?: string[]; // blocklist
}

// MCP Protocol Messages (JSON-RPC 2.0)
export interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

export interface MCPResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result?: T;
  error?: MCPError;
}

export interface MCPError {
  code: number;
  message: string;
  data?: unknown;
}

// Tool Discovery
export interface MCPToolsListResponse {
  tools: MCPTool[];
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: MCPToolInputSchema;
}

export interface MCPToolInputSchema {
  type: 'object';
  properties?: Record<string, MCPSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface MCPSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: MCPSchemaProperty;
  properties?: Record<string, MCPSchemaProperty>;
  required?: string[];
}

// Tool Execution
export interface MCPCallToolRequest {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface MCPCallToolResponse {
  content: MCPContent[];
  isError?: boolean;
}

export type MCPContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string; mimeType?: string; text?: string } };

// MCP Resources
export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  annotations?: {
    audience?: ('user' | 'assistant')[];
    priority?: number;
  };
}

export interface MCPResourceTemplate {
  uriTemplate: string; // e.g., "file:///{path}"
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPResourceContents {
  uri: string;
  mimeType?: string;
  text?: string; // Text content
  blob?: string; // Base64-encoded binary
}

export interface MCPListResourcesResponse {
  resources: MCPResource[];
  nextCursor?: string;
}

export interface MCPListResourceTemplatesResponse {
  resourceTemplates: MCPResourceTemplate[];
  nextCursor?: string;
}

export interface MCPReadResourceResponse {
  contents: MCPResourceContents[];
}

// MCP Prompts
export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface MCPPromptMessage {
  role: 'user' | 'assistant';
  content: {
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
    resource?: {
      uri: string;
      text?: string;
      blob?: string;
      mimeType?: string;
    };
  };
}

export interface MCPListPromptsResponse {
  prompts: MCPPrompt[];
  nextCursor?: string;
}

export interface MCPGetPromptRequest {
  name: string;
  arguments?: Record<string, string>;
}

export interface MCPGetPromptResponse {
  messages: MCPPromptMessage[];
  description?: string;
}

// Server Capabilities (from initialization)
export interface MCPServerCapabilities {
  tools?: {
    listChanged?: boolean;
  };
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
  };
  prompts?: {
    listChanged?: boolean;
  };
}

// MCP Server State
export enum MCPServerStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
}

export interface MCPServerState {
  name: string;
  config: MCPServerConfig;
  status: MCPServerStatus;
  tools: MCPTool[];
  resources: MCPResource[];
  prompts: MCPPrompt[];
  capabilities?: MCPServerCapabilities;
  error?: string;
}
