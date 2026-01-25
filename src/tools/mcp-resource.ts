/**
 * MCP Resource Access Tools
 * Tools for listing and reading resources from connected MCP servers
 */

import type { Tool, ToolExecutionContext, ToolExecutionResult } from '../types.js';
import type { MCPManagerV2 } from '../mcp-client-v2.js';

export function createListMCPResourcesTool(mcpManager: MCPManagerV2): Tool {
  return {
    definition: {
      name: 'list_mcp_resources',
      description: `List all resources available from connected MCP servers. Resources are data sources (files, documents, database records, etc.) that MCP servers expose.

Returns a list of resources with their URI, name, description, and MIME type.

Example:
- To see what resources are available: list_mcp_resources with serverName = "filesystem"`,
      input_schema: {
        type: 'object',
        properties: {
          serverName: {
            type: 'string',
            description:
              'Name of the MCP server to list resources from (e.g., "filesystem", "database")',
          },
        },
        required: ['serverName'],
      },
    },
    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
      const { serverName } = input as { serverName: string };

      const server = mcpManager.getServer(serverName);
      if (!server) {
        return {
          success: false,
          error: `MCP server '${serverName}' not found`,
        };
      }

      try {
        const resources = await server.listResources();

        if (resources.length === 0) {
          return {
            success: true,
            output: `No resources available from server '${serverName}'`,
          };
        }

        const resourceList = resources
          .map((resource, idx) => {
            let info = `${idx + 1}. ${resource.name}`;
            info += `\n   URI: ${resource.uri}`;
            if (resource.description) {
              info += `\n   Description: ${resource.description}`;
            }
            if (resource.mimeType) {
              info += `\n   Type: ${resource.mimeType}`;
            }
            if (resource.annotations?.audience) {
              info += `\n   Audience: ${resource.annotations.audience.join(', ')}`;
            }
            return info;
          })
          .join('\n\n');

        return {
          success: true,
          output: `Resources from '${serverName}' (${resources.length} total):\n\n${resourceList}`,
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to list resources: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}

export function createReadMCPResourceTool(mcpManager: MCPManagerV2): Tool {
  return {
    definition: {
      name: 'read_mcp_resource',
      description: `Read the contents of a specific resource from an MCP server. Resources can contain text or binary data.

Returns the resource contents (text or base64-encoded binary).

Example:
- To read a file: read_mcp_resource with serverName = "filesystem" and uri = "file:///path/to/file.txt"
- To read a database record: read_mcp_resource with serverName = "database" and uri = "db://users/123"`,
      input_schema: {
        type: 'object',
        properties: {
          serverName: {
            type: 'string',
            description: 'Name of the MCP server that owns the resource',
          },
          uri: {
            type: 'string',
            description:
              'URI of the resource to read (e.g., "file:///path/to/file.txt", "db://table/record/123")',
          },
        },
        required: ['serverName', 'uri'],
      },
    },
    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
      const { serverName, uri } = input as { serverName: string; uri: string };

      const server = mcpManager.getServer(serverName);
      if (!server) {
        return {
          success: false,
          error: `MCP server '${serverName}' not found`,
        };
      }

      try {
        const contents = await server.readResource(uri);

        if (contents.length === 0) {
          return {
            success: true,
            output: `Resource '${uri}' is empty`,
          };
        }

        let result = `Contents of resource '${uri}':\n\n`;

        for (const content of contents) {
          if (content.mimeType) {
            result += `Type: ${content.mimeType}\n`;
          }

          if (content.text !== undefined) {
            result += `${content.text}`;
          } else if (content.blob !== undefined) {
            result += `[Binary data, base64-encoded: ${content.blob.length} bytes]\n`;
            result += `First 100 chars: ${content.blob.substring(0, 100)}...`;
          }
        }

        return {
          success: true,
          output: result,
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to read resource: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}

export function createListMCPPromptsTool(mcpManager: MCPManagerV2): Tool {
  return {
    definition: {
      name: 'list_mcp_prompts',
      description: `List all prompt templates available from connected MCP servers. Prompts are reusable templates that help structure interactions with LLMs.

Returns a list of prompts with their name, description, and required arguments.

Example:
- To see what prompts are available: list_mcp_prompts with serverName = "code-helper"`,
      input_schema: {
        type: 'object',
        properties: {
          serverName: {
            type: 'string',
            description:
              'Name of the MCP server to list prompts from (e.g., "code-helper", "documentation")',
          },
        },
        required: ['serverName'],
      },
    },
    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
      const { serverName } = input as { serverName: string };

      const server = mcpManager.getServer(serverName);
      if (!server) {
        return {
          success: false,
          error: `MCP server '${serverName}' not found`,
        };
      }

      try {
        const prompts = await server.listPrompts();

        if (prompts.length === 0) {
          return {
            success: true,
            output: `No prompts available from server '${serverName}'`,
          };
        }

        const promptList = prompts
          .map((prompt, idx) => {
            let info = `${idx + 1}. ${prompt.name}`;
            if (prompt.description) {
              info += `\n   Description: ${prompt.description}`;
            }
            if (prompt.arguments && prompt.arguments.length > 0) {
              const argsList = prompt.arguments
                .map((arg) => {
                  let argInfo = `     - ${arg.name}${arg.required ? ' (required)' : ' (optional)'}`;
                  if (arg.description) {
                    argInfo += `: ${arg.description}`;
                  }
                  return argInfo;
                })
                .join('\n');
              info += `\n   Arguments:\n${argsList}`;
            }
            return info;
          })
          .join('\n\n');

        return {
          success: true,
          output: `Prompts from '${serverName}' (${prompts.length} total):\n\n${promptList}`,
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to list prompts: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}

export function createGetMCPPromptTool(mcpManager: MCPManagerV2): Tool {
  return {
    definition: {
      name: 'get_mcp_prompt',
      description: `Get a specific prompt template from an MCP server with optional arguments. The prompt returns a sequence of messages ready to use with the LLM.

Returns the prompt messages and description.

Example:
- To get a code review prompt: get_mcp_prompt with serverName = "code-helper", promptName = "review-code", and arguments = {"language": "typescript", "focus": "security"}`,
      input_schema: {
        type: 'object',
        properties: {
          serverName: {
            type: 'string',
            description: 'Name of the MCP server that owns the prompt',
          },
          promptName: {
            type: 'string',
            description: 'Name of the prompt to retrieve',
          },
          arguments: {
            type: 'object',
            description:
              'Arguments to pass to the prompt template (as key-value pairs)',
            properties: {},
          },
        },
        required: ['serverName', 'promptName'],
      },
    },
    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
      const { serverName, promptName, arguments: promptArgs } = input as {
        serverName: string;
        promptName: string;
        arguments?: Record<string, string>;
      };

      const server = mcpManager.getServer(serverName);
      if (!server) {
        return {
          success: false,
          error: `MCP server '${serverName}' not found`,
        };
      }

      try {
        const result = await server.getPrompt(promptName, promptArgs);

        let output = `Prompt '${promptName}'`;
        if (result.description) {
          output += `\nDescription: ${result.description}`;
        }
        output += `\n\nMessages (${result.messages.length} total):\n\n`;

        for (const msg of result.messages) {
          output += `[${msg.role.toUpperCase()}]\n`;

          if (msg.content.type === 'text' && msg.content.text) {
            output += msg.content.text;
          } else if (msg.content.type === 'image' && msg.content.data) {
            output += `[Image: ${msg.content.mimeType || 'unknown type'}]`;
          } else if (msg.content.type === 'resource' && msg.content.resource) {
            output += `[Resource: ${msg.content.resource.uri}]`;
            if (msg.content.resource.text) {
              output += `\n${msg.content.resource.text}`;
            }
          }

          output += '\n\n';
        }

        return {
          success: true,
          output,
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to get prompt: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
