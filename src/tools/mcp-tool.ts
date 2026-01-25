/**
 * MCP Tool Wrapper - Wraps external MCP tools as native tools
 */

import type { Tool, ToolDefinition, ToolExecutionContext, ToolExecutionResult } from '../types.js';
import type { MCPClient } from '../mcp-client.js';
import type { MCPClientV2 } from '../mcp-client-v2.js';
import type { MCPTool, MCPCallToolResponse } from '../mcp-types.js';

export class MCPToolWrapper implements Tool {
  public definition: ToolDefinition;

  constructor(
    private mcpTool: MCPTool,
    private client: MCPClient | MCPClientV2,
    private serverName: string,
    private trustServer: boolean = false
  ) {
    // Convert MCP tool schema to our ToolDefinition format
    this.definition = this.convertToToolDefinition(mcpTool);
  }

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    try {
      // Always log MCP tool calls for debugging
      console.error(`\n[MCP DEBUG] Calling tool: ${this.mcpTool.name}`);
      console.error(`[MCP DEBUG] Input keys: ${Object.keys(input).join(', ') || '(empty)'}`);
      console.error(`[MCP DEBUG] Input: ${JSON.stringify(input)}`);

      const response: MCPCallToolResponse = await this.client.callTool({
        name: this.mcpTool.name,
        arguments: input,
      });

      if (response.isError) {
        return {
          success: false,
          error: this.formatContent(response.content),
        };
      }

      return {
        success: true,
        output: this.formatContent(response.content),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  shouldConfirm(input: Record<string, unknown>): boolean {
    // If server is trusted, no confirmation needed
    if (this.trustServer) {
      return false;
    }

    // By default, all MCP tools require confirmation unless trusted
    // (Future: implement per-tool trust lists)
    return true;
  }

  private convertToToolDefinition(mcpTool: MCPTool): ToolDefinition {
    const inputSchema = mcpTool.inputSchema;

    // Convert MCP schema properties to ToolParameters
    const properties: Record<string, any> = {};
    const paramNames: string[] = [];
    
    if (inputSchema.properties) {
      for (const [key, value] of Object.entries(inputSchema.properties)) {
        properties[key] = {
          ...value,
          description: value.description || '', // Ensure description is always present
        };
        paramNames.push(key);
      }
    }

    // Enhance description with explicit parameter names to help LLM
    let description = mcpTool.description || `MCP tool: ${mcpTool.name}`;
    if (paramNames.length > 0) {
      const requiredParams = inputSchema.required || [];
      const paramInfo = paramNames.map(p => {
        const isRequired = requiredParams.includes(p);
        return `${p}${isRequired ? ' (required)' : ' (optional)'}`;
      }).join(', ');
      description += `. Parameters: ${paramInfo}`;
    }

    return {
      name: this.prefixToolName(mcpTool.name),
      description,
      input_schema: {
        type: 'object',
        properties,
        required: inputSchema.required || [],
      },
    };
  }

  private prefixToolName(toolName: string): string {
    // Prefix with server name to avoid conflicts: serverName__toolName
    return `${this.serverName}__${toolName}`;
  }

  private formatContent(content: MCPCallToolResponse['content']): string {
    const parts: string[] = [];

    for (const item of content) {
      if (item.type === 'text') {
        parts.push(item.text);
      } else if (item.type === 'image') {
        parts.push(`[Image: ${item.mimeType}]`);
      } else if (item.type === 'resource' && item.resource.text) {
        parts.push(item.resource.text);
      }
    }

    return parts.join('\n');
  }

  getServerName(): string {
    return this.serverName;
  }

  getOriginalToolName(): string {
    return this.mcpTool.name;
  }
}
