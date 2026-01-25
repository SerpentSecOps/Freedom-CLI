/**
 * Plugins system - Claude Code plugin compatibility layer
 * Exports all plugin functionality
 */

export { PluginLoader } from './plugin-loader.js';
export { CommandRegistry, commandRegistry, loadCommandsFromDirectory } from './command-loader.js';
export { AgentRegistry, agentRegistry, loadAgentsFromDirectory, agentToSkillContext } from './agent-loader.js';
export { HookManager, hookManager } from './hook-manager.js';
export {
  parsePluginManifest,
  parseCommandFile,
  parseAgentFile,
  parseHooksConfig,
  parseLSPServersConfig,
  parseMCPServersConfig,
  substituteCommandArguments,
  extractInlineBash,
  extractFileReferences,
} from './plugin-parser.js';
export type {
  PluginManifest,
  CommandDefinition,
  AgentDefinition,
  Hook,
  HookType,
  HookEvent,
  HooksConfig,
  HookResult,
  LoadedPlugin,
  PluginsConfig,
  PluginMarketplaceEntry,
} from './plugin-types.js';

import type { LoadedPlugin } from './plugin-types.js';
import { PluginLoader } from './plugin-loader.js';
import { commandRegistry } from './command-loader.js';
import { agentRegistry, agentToSkillContext } from './agent-loader.js';
import { hookManager } from './hook-manager.js';

/**
 * Plugin manager - manages all loaded plugins
 */
class PluginManager {
  private plugins: Map<string, LoadedPlugin> = new Map();

  /**
   * Register a plugin
   */
  registerPlugin(plugin: LoadedPlugin): void {
    this.plugins.set(plugin.manifest.name, plugin);

    // Register all components
    for (const command of plugin.commands.values()) {
      commandRegistry.registerCommand(command);
    }

    for (const agent of plugin.agents.values()) {
      agentRegistry.registerAgent(agent);
    }

    for (const hook of plugin.hooks) {
      hookManager.registerHook(hook);
    }

    // Register LSP servers if any
    if (plugin.lspServers.size > 0) {
      // Convert Map to Record for loadPluginLSPServers
      const lspServers: Record<string, any> = {};
      for (const [name, config] of plugin.lspServers.entries()) {
        lspServers[name] = config;
      }

      // Load LSP servers (dynamic import to avoid circular dependencies)
      import('../lsp/index.js').then(({ loadPluginLSPServers }) => {
        loadPluginLSPServers(plugin.path, lspServers).catch(error => {
          console.error(`Failed to load LSP servers from plugin ${plugin.manifest.name}: ${error.message}`);
        });
      }).catch(error => {
        console.error(`Failed to import LSP module for plugin ${plugin.manifest.name}: ${error.message}`);
      });
    }

    // Register MCP servers if any
    if (plugin.mcpServers.size > 0) {
      // Convert Map to Record for MCP registration
      const mcpServers: Record<string, any> = {};
      for (const [name, config] of plugin.mcpServers.entries()) {
        // Substitute ${CLAUDE_PLUGIN_ROOT} in MCP server configs
        const processedConfig = substitutePluginRoot(config, plugin.path);
        mcpServers[`plugin-${plugin.manifest.name}-${name}`] = processedConfig;
      }

      // Load MCP servers (dynamic import to avoid circular dependencies)
      Promise.all([
        import('../mcp-integration.js'),
        import('../tools/index.js')
      ]).then(async ([{ mcpIntegration }, { toolRegistry }]) => {
        try {
          // Get MCP manager from integration
          const manager = mcpIntegration.getManager();

          // Register each MCP server and discover tools
          for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
            try {
              await manager.addServer(serverName, serverConfig);

              // Discover and register tools from this server
              const toolsByServer = await manager.discoverAllTools();
              const tools = toolsByServer.get(serverName) || [];

              if (tools.length > 0) {
                const { MCPToolWrapper } = await import('../tools/mcp-tool.js');
                const client = manager.getServer(serverName)!;

                for (const tool of tools) {
                  const wrapper = new MCPToolWrapper(tool, client, serverName, false);
                  toolRegistry.register(wrapper);
                }

                console.log(`  ✓ MCP server '${serverName}' registered from plugin ${plugin.manifest.name} (${tools.length} tools)`);
              } else {
                console.log(`  ✓ MCP server '${serverName}' registered from plugin ${plugin.manifest.name}`);
              }
            } catch (error: any) {
              console.error(`  ✗ Failed to register MCP server '${serverName}': ${error.message}`);
            }
          }
        } catch (error: any) {
          console.error(`Failed to load MCP servers from plugin ${plugin.manifest.name}: ${error.message}`);
        }
      }).catch(error => {
        console.error(`Failed to import MCP module for plugin ${plugin.manifest.name}: ${error.message}`);
      });
    }
  }

  /**
   * Unregister a plugin
   */
  unregisterPlugin(name: string): boolean {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      return false;
    }

    // Unregister all components
    for (const command of plugin.commands.values()) {
      commandRegistry.unregisterCommand(command.name);
    }

    for (const agent of plugin.agents.values()) {
      agentRegistry.unregisterAgent(agent.name);
    }

    return this.plugins.delete(name);
  }

  /**
   * Get a plugin by name
   */
  getPlugin(name: string): LoadedPlugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Get all plugins
   */
  getAllPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Activate a plugin
   */
  activatePlugin(name: string): boolean {
    const plugin = this.plugins.get(name);
    if (plugin) {
      plugin.active = true;
      return true;
    }
    return false;
  }

  /**
   * Deactivate a plugin
   */
  deactivatePlugin(name: string): boolean {
    const plugin = this.plugins.get(name);
    if (plugin) {
      plugin.active = false;
      return true;
    }
    return false;
  }

  /**
   * Clear all plugins
   */
  clear(): void {
    this.plugins.clear();
    commandRegistry.clear();
    agentRegistry.clear();
    hookManager.clear();
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalPlugins: number;
    activePlugins: number;
    totalCommands: number;
    totalAgents: number;
    totalHooks: number;
  } {
    const active = Array.from(this.plugins.values()).filter(p => p.active).length;
    const hookStats = hookManager.getStats();

    return {
      totalPlugins: this.plugins.size,
      activePlugins: active,
      totalCommands: commandRegistry.getAllCommands().length,
      totalAgents: agentRegistry.getAllAgents().length,
      totalHooks: hookStats.totalHooks,
    };
  }
}

/**
 * Substitute ${CLAUDE_PLUGIN_ROOT} in MCP server config
 */
function substitutePluginRoot(config: any, pluginPath: string): any {
  if (!config || typeof config !== 'object') {
    return config;
  }

  if (Array.isArray(config)) {
    return config.map(item => substitutePluginRoot(item, pluginPath));
  }

  const result: any = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string') {
      result[key] = value.replace(/\${CLAUDE_PLUGIN_ROOT}/g, pluginPath);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = substitutePluginRoot(value, pluginPath);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Global plugin manager instance
 */
export const pluginManager = new PluginManager();

/**
 * Initialize plugins system - loads plugins from config paths
 */
export async function initializePlugins(config: {
  enabled?: boolean;
  autoLoad?: boolean;
  paths?: string[];
  marketplaces?: string[];
}): Promise<void> {
  // Skip if plugins disabled or no config
  if (config.enabled === false || !config.autoLoad) {
    return;
  }

  const loader = new PluginLoader();
  const loadedCount = { plugins: 0, commands: 0, agents: 0, hooks: 0, errors: 0 };

  // Load from configured paths
  if (config.paths && config.paths.length > 0) {
    for (const path of config.paths) {
      try {
        const plugins = await loader.loadPluginsFromDirectory(path);
        for (const plugin of plugins) {
          pluginManager.registerPlugin(plugin);
          pluginManager.activatePlugin(plugin.manifest.name);

          loadedCount.plugins++;
          loadedCount.commands += plugin.commands.size;
          loadedCount.agents += plugin.agents.size;
          loadedCount.hooks += plugin.hooks.length;
        }
      } catch (error: any) {
        console.error(`Warning: Failed to load plugins from ${path}: ${error.message}`);
        loadedCount.errors++;
      }
    }
  }

  // TODO: Load from marketplaces (Phase 3)

  // Log results if any plugins loaded
  if (loadedCount.plugins > 0) {
    console.log(`✓ Loaded ${loadedCount.plugins} plugin(s)`);
    if (loadedCount.commands > 0) {
      console.log(`  - ${loadedCount.commands} command(s)`);
    }
    if (loadedCount.agents > 0) {
      console.log(`  - ${loadedCount.agents} agent(s)`);
    }
    if (loadedCount.hooks > 0) {
      console.log(`  - ${loadedCount.hooks} hook(s)`);
    }
    if (loadedCount.errors > 0) {
      console.log(`⚠ ${loadedCount.errors} error(s) while loading plugins`);
    }
  }
}

/**
 * Build plugin context for system prompt injection
 * Includes agents as specialized skills
 */
export async function buildPluginContext(): Promise<string> {
  const agents = agentRegistry.getAllAgents();

  if (agents.length === 0) {
    return '';
  }

  const sections: string[] = [];

  for (const agent of agents) {
    sections.push(agentToSkillContext(agent));
  }

  return `
# Available Plugin Agents

The following specialized agents are available from loaded plugins:

${sections.join('\n---\n\n')}
`;
}
