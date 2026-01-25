/**
 * MCP Integration Module
 * Discovers and registers MCP tools into the tool registry
 */

import { MCPManagerV2 } from './mcp-client-v2.js';
import { MCPToolWrapper } from './tools/mcp-tool.js';
import {
  createListMCPResourcesTool,
  createReadMCPResourceTool,
  createListMCPPromptsTool,
  createGetMCPPromptTool,
} from './tools/mcp-resource.js';
import { ToolRegistry } from './tools/registry.js';
import type { AgenticCliConfig } from './types.js';

export class MCPIntegration {
  private manager: MCPManagerV2;

  constructor() {
    this.manager = new MCPManagerV2();
  }

  /**
   * Initialize MCP servers from config and discover tools
   */
  async initialize(config: AgenticCliConfig, toolRegistry: ToolRegistry): Promise<void> {
    if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
      // No MCP servers configured
      return;
    }

    console.log('🔌 Initializing MCP servers...');

    const serverNames = Object.keys(config.mcpServers);
    const results = await Promise.allSettled(
      serverNames.map(async (name) => {
        const serverConfig = config.mcpServers![name];
        console.log(`  Connecting to ${name}...`);

        try {
          await this.manager.addServer(name, serverConfig);
          console.log(`  ✓ ${name} connected`);
        } catch (error) {
          console.error(`  ✗ ${name} failed:`, error instanceof Error ? error.message : error);
          throw error;
        }
      })
    );

    // Count successes
    const successCount = results.filter((r) => r.status === 'fulfilled').length;
    console.log(`\n📡 ${successCount}/${serverNames.length} MCP servers connected`);

    // Discover tools from all connected servers
    console.log('\n🔍 Discovering MCP tools...');
    const toolsByServer = await this.manager.discoverAllTools();

    let totalToolsDiscovered = 0;
    for (const [serverName, tools] of toolsByServer.entries()) {
      if (tools.length === 0) {
        console.log(`  ${serverName}: No tools`);
        continue;
      }

      console.log(`  ${serverName}: ${tools.length} tool(s)`);

      const serverConfig = config.mcpServers![serverName];
      const client = this.manager.getServer(serverName)!;

      // Register each tool
      for (const tool of tools) {
        const wrapper = new MCPToolWrapper(
          tool,
          client,
          serverName,
          serverConfig.trust || false
        );

        toolRegistry.register(wrapper);
        totalToolsDiscovered++;
      }
    }

    console.log(`\n✨ ${totalToolsDiscovered} MCP tools registered`);

    // Register MCP resource and prompt access tools
    console.log('🔧 Registering MCP resource and prompt tools...');
    toolRegistry.register(createListMCPResourcesTool(this.manager));
    toolRegistry.register(createReadMCPResourceTool(this.manager));
    toolRegistry.register(createListMCPPromptsTool(this.manager));
    toolRegistry.register(createGetMCPPromptTool(this.manager));
    console.log('✓ 4 MCP resource/prompt tools registered\n');
  }

  /**
   * Get the MCP manager instance
   */
  getManager(): MCPManagerV2 {
    return this.manager;
  }

  /**
   * Shutdown all MCP connections
   */
  shutdown(): void {
    this.manager.disconnectAll();
  }
}

/**
 * Global MCP integration instance
 */
export const mcpIntegration = new MCPIntegration();
