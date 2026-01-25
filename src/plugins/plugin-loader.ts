/**
 * Plugin loader - orchestrates loading of complete plugins
 */

import { readdir, access, stat } from 'fs/promises';
import { join, resolve } from 'path';
import type { LoadedPlugin, PluginManifest } from './plugin-types.js';
import { parsePluginManifest, parseHooksConfig, parseLSPServersConfig, parseMCPServersConfig } from './plugin-parser.js';
import { loadCommandsFromDirectory } from './command-loader.js';
import { loadAgentsFromDirectory } from './agent-loader.js';

/**
 * Plugin loader class
 */
export class PluginLoader {
  /**
   * Load a plugin from a directory
   */
  async loadPlugin(pluginPath: string): Promise<LoadedPlugin> {
    const absolutePath = resolve(pluginPath);

    // Check if .claude-plugin directory exists
    const pluginConfigDir = join(absolutePath, '.claude-plugin');
    try {
      await access(pluginConfigDir);
    } catch {
      throw new Error(`Plugin directory must contain .claude-plugin/ subdirectory: ${absolutePath}`);
    }

    // Parse plugin manifest
    const manifestPath = join(pluginConfigDir, 'plugin.json');
    const manifest = await parsePluginManifest(manifestPath);

    const plugin: LoadedPlugin = {
      manifest,
      path: absolutePath,
      commands: new Map(),
      agents: new Map(),
      hooks: [],
      lspServers: new Map(),
      mcpServers: new Map(),
      active: false,
    };

    // Load commands if configured
    if (manifest.commands) {
      const commandsDir = join(absolutePath, manifest.commands);
      try {
        const commands = await loadCommandsFromDirectory(commandsDir);
        for (const command of commands) {
          plugin.commands.set(command.name, command);
        }
      } catch (error: any) {
        console.error(`Failed to load commands from plugin ${manifest.name}: ${error.message}`);
      }
    }

    // Load agents if configured
    if (manifest.agents && manifest.agents.length > 0) {
      for (const agentPath of manifest.agents) {
        const agentsDir = join(absolutePath, agentPath);
        try {
          const agents = await loadAgentsFromDirectory(agentsDir);
          for (const agent of agents) {
            plugin.agents.set(agent.name, agent);
          }
        } catch (error: any) {
          console.error(`Failed to load agents from plugin ${manifest.name}: ${error.message}`);
        }
      }
    }

    // Load hooks if configured
    if (manifest.hooks) {
      const hooksPath = join(absolutePath, manifest.hooks);
      try {
        const hooksConfig = await parseHooksConfig(hooksPath);
        plugin.hooks = hooksConfig.hooks;
      } catch (error: any) {
        console.error(`Failed to load hooks from plugin ${manifest.name}: ${error.message}`);
      }
    }

    // Load LSP servers if configured
    if (manifest.lspServers) {
      const lspServersPath = join(absolutePath, manifest.lspServers);
      try {
        const lspServersConfig = await parseLSPServersConfig(lspServersPath);
        for (const [name, config] of Object.entries(lspServersConfig)) {
          plugin.lspServers.set(name, config);
        }
      } catch (error: any) {
        console.error(`Failed to load LSP servers from plugin ${manifest.name}: ${error.message}`);
      }
    }

    // Load MCP servers if configured
    if (manifest.mcpServers) {
      const mcpServersPath = join(absolutePath, manifest.mcpServers);
      try {
        const mcpServersConfig = await parseMCPServersConfig(mcpServersPath);
        for (const [name, config] of Object.entries(mcpServersConfig)) {
          plugin.mcpServers.set(name, config);
        }
      } catch (error: any) {
        console.error(`Failed to load MCP servers from plugin ${manifest.name}: ${error.message}`);
      }
    }

    return plugin;
  }

  /**
   * Load all plugins from a directory
   * Scans for subdirectories containing .claude-plugin/
   */
  async loadPluginsFromDirectory(directory: string): Promise<LoadedPlugin[]> {
    const plugins: LoadedPlugin[] = [];
    const absoluteDir = resolve(directory);

    try {
      await access(absoluteDir);
      const entries = await readdir(absoluteDir);

      for (const entry of entries) {
        const entryPath = join(absoluteDir, entry);
        const entryStat = await stat(entryPath);

        if (entryStat.isDirectory()) {
          // Check if this directory is a plugin
          const pluginConfigPath = join(entryPath, '.claude-plugin', 'plugin.json');
          try {
            await access(pluginConfigPath);
            // It's a plugin!
            const plugin = await this.loadPlugin(entryPath);
            plugins.push(plugin);
          } catch {
            // Not a plugin, skip
            continue;
          }
        }
      }
    } catch (error: any) {
      throw new Error(`Failed to load plugins from directory ${directory}: ${error.message}`);
    }

    return plugins;
  }

  /**
   * Check if a directory is a plugin
   */
  async isPluginDirectory(directory: string): Promise<boolean> {
    try {
      const manifestPath = join(directory, '.claude-plugin', 'plugin.json');
      await access(manifestPath);
      return true;
    } catch {
      return false;
    }
  }
}
