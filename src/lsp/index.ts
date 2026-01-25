/**
 * LSP system - Language Server Protocol integration
 * Exports all LSP functionality
 */

export { LSPClient } from './lsp-client.js';
export { LSPManager, lspManager } from './lsp-manager.js';
export type {
  LSPServerConfig,
  LSPServerState,
  Position,
  Range,
  Location,
  Diagnostic,
  DiagnosticSeverity,
  SymbolInformation,
  Hover,
  CompletionItem,
  LSPOperation,
  LSPRequestParams,
  LSPResponse,
  CallHierarchyItem,
  CallHierarchyIncomingCall,
  CallHierarchyOutgoingCall,
} from './lsp-types.js';

import { lspManager } from './lsp-manager.js';
import type { LSPServerConfig } from './lsp-types.js';

/**
 * Initialize LSP servers from configuration
 */
export async function initializeLSPServers(
  servers: Record<string, LSPServerConfig>
): Promise<void> {
  if (!servers || Object.keys(servers).length === 0) {
    return;
  }

  let registeredCount = 0;
  let errorCount = 0;

  for (const [name, config] of Object.entries(servers)) {
    try {
      await lspManager.registerServer(name, config);
      registeredCount++;
    } catch (error: any) {
      console.error(`Warning: Failed to register LSP server ${name}: ${error.message}`);
      errorCount++;
    }
  }

  if (registeredCount > 0) {
    // Start all servers
    try {
      await lspManager.startAllServers();
      const stats = lspManager.getStats();
      console.log(`✓ Started ${stats.runningServers}/${stats.totalServers} LSP server(s)`);
      console.log(`  Supporting ${stats.supportedExtensions} file extension(s)`);

      if (errorCount > 0) {
        console.log(`⚠ ${errorCount} LSP server(s) failed to start`);
      }
    } catch (error: any) {
      console.error(`Warning: Failed to start LSP servers: ${error.message}`);
    }
  }
}

/**
 * Load LSP servers from a plugin
 */
export async function loadPluginLSPServers(
  pluginPath: string,
  lspServers: Record<string, LSPServerConfig>
): Promise<void> {
  if (!lspServers || Object.keys(lspServers).length === 0) {
    return;
  }

  // Process each LSP server config
  for (const [name, config] of Object.entries(lspServers)) {
    // Substitute ${CLAUDE_PLUGIN_ROOT} with plugin path
    const processedConfig: LSPServerConfig = {
      ...config,
      command: config.command.replace(/\${CLAUDE_PLUGIN_ROOT}/g, pluginPath),
      args: config.args?.map(arg => arg.replace(/\${CLAUDE_PLUGIN_ROOT}/g, pluginPath)),
      env: config.env
        ? Object.entries(config.env).reduce((acc, [key, value]) => {
            acc[key] = value.replace(/\${CLAUDE_PLUGIN_ROOT}/g, pluginPath);
            return acc;
          }, {} as Record<string, string>)
        : undefined,
      cwd: config.cwd?.replace(/\${CLAUDE_PLUGIN_ROOT}/g, pluginPath),
    };

    try {
      await lspManager.registerServer(`plugin-${name}`, processedConfig);
      await lspManager.startServer(`plugin-${name}`);
    } catch (error: any) {
      console.error(`Warning: Failed to load LSP server ${name} from plugin: ${error.message}`);
    }
  }
}
