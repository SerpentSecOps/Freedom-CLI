/**
 * Plugin parser - parses plugin.json, commands, agents, and hooks
 */

import { readFile } from 'fs/promises';
import matter from 'gray-matter';
import type {
  PluginManifest,
  CommandDefinition,
  AgentDefinition,
  HooksConfig,
} from './plugin-types.js';

/**
 * Parse a plugin.json manifest file
 */
export async function parsePluginManifest(manifestPath: string): Promise<PluginManifest> {
  try {
    const content = await readFile(manifestPath, 'utf-8');
    const manifest: PluginManifest = JSON.parse(content);

    // Validate required fields
    if (!manifest.name) {
      throw new Error('Plugin manifest missing required field: name');
    }

    return manifest;
  } catch (error: any) {
    throw new Error(`Failed to parse plugin manifest ${manifestPath}: ${error.message}`);
  }
}

/**
 * Parse a command .md file
 */
export async function parseCommandFile(commandPath: string, commandName: string): Promise<CommandDefinition> {
  try {
    const content = await readFile(commandPath, 'utf-8');
    const parsed = matter(content);

    return {
      name: commandName,
      description: parsed.data.description || '',
      argumentHint: parsed.data['argument-hint'] || parsed.data.argumentHint,
      allowedTools: parsed.data['allowed-tools'] || parsed.data.allowedTools,
      model: parsed.data.model,
      instructions: parsed.content.trim(),
      path: commandPath,
    };
  } catch (error: any) {
    throw new Error(`Failed to parse command file ${commandPath}: ${error.message}`);
  }
}

/**
 * Parse an agent .md file
 */
export async function parseAgentFile(agentPath: string): Promise<AgentDefinition> {
  try {
    const content = await readFile(agentPath, 'utf-8');
    const parsed = matter(content);

    // Validate required fields
    if (!parsed.data.name) {
      throw new Error(`Agent file ${agentPath} missing required field: name`);
    }
    if (!parsed.data.description) {
      throw new Error(`Agent file ${agentPath} missing required field: description`);
    }

    return {
      name: parsed.data.name,
      description: parsed.data.description,
      model: parsed.data.model,
      color: parsed.data.color,
      tools: parsed.data.tools,
      instructions: parsed.content.trim(),
      path: agentPath,
    };
  } catch (error: any) {
    throw new Error(`Failed to parse agent file ${agentPath}: ${error.message}`);
  }
}

/**
 * Parse a hooks.json configuration file
 */
export async function parseHooksConfig(hooksPath: string): Promise<HooksConfig> {
  try {
    const content = await readFile(hooksPath, 'utf-8');
    const config: HooksConfig = JSON.parse(content);

    // Validate structure
    if (!config.hooks || !Array.isArray(config.hooks)) {
      throw new Error('Invalid hooks.json: must have "hooks" array');
    }

    return config;
  } catch (error: any) {
    throw new Error(`Failed to parse hooks config ${hooksPath}: ${error.message}`);
  }
}

/**
 * Parse an lsp-servers.json configuration file
 */
export async function parseLSPServersConfig(lspServersPath: string): Promise<Record<string, any>> {
  try {
    const content = await readFile(lspServersPath, 'utf-8');
    const config = JSON.parse(content);

    // Validate it's an object
    if (typeof config !== 'object' || config === null) {
      throw new Error('Invalid lsp-servers.json: must be a JSON object');
    }

    return config;
  } catch (error: any) {
    throw new Error(`Failed to parse LSP servers config ${lspServersPath}: ${error.message}`);
  }
}

/**
 * Parse an .mcp.json configuration file
 */
export async function parseMCPServersConfig(mcpServersPath: string): Promise<Record<string, any>> {
  try {
    const content = await readFile(mcpServersPath, 'utf-8');
    const config = JSON.parse(content);

    // Validate it's an object with mcpServers key
    if (typeof config !== 'object' || config === null) {
      throw new Error('Invalid .mcp.json: must be a JSON object');
    }

    // MCP config should have mcpServers key
    if (config.mcpServers && typeof config.mcpServers === 'object') {
      return config.mcpServers;
    }

    // Fallback: treat entire file as server configs
    return config;
  } catch (error: any) {
    throw new Error(`Failed to parse MCP servers config ${mcpServersPath}: ${error.message}`);
  }
}

/**
 * Process command arguments substitution
 * Supports: $ARGUMENTS, $1, $2, $3, etc.
 */
export function substituteCommandArguments(
  instructions: string,
  args: string[]
): string {
  let result = instructions;

  // Substitute $ARGUMENTS with all arguments joined
  result = result.replace(/\$ARGUMENTS/g, args.join(' '));

  // Substitute $1, $2, $3, etc. with individual arguments
  args.forEach((arg, index) => {
    const placeholder = new RegExp(`\\$${index + 1}`, 'g');
    result = result.replace(placeholder, arg);
  });

  return result;
}

/**
 * Process inline bash execution in commands
 * Supports: !`command` syntax
 * Returns: { text: string, bashCommands: string[] }
 */
export function extractInlineBash(instructions: string): {
  text: string;
  bashCommands: string[];
} {
  const bashCommands: string[] = [];
  const bashPattern = /!\`([^`]+)\`/g;

  const text = instructions.replace(bashPattern, (match, command) => {
    bashCommands.push(command.trim());
    return `[BASH_${bashCommands.length - 1}]`; // Placeholder
  });

  return { text, bashCommands };
}

/**
 * Process file references in commands
 * Supports: @file-path syntax
 * Returns: { text: string, fileRefs: string[] }
 */
export function extractFileReferences(instructions: string): {
  text: string;
  fileRefs: string[];
} {
  const fileRefs: string[] = [];
  const filePattern = /@([^\s]+)/g;

  const text = instructions.replace(filePattern, (match, filePath) => {
    fileRefs.push(filePath.trim());
    return `[FILE_${fileRefs.length - 1}]`; // Placeholder
  });

  return { text, fileRefs };
}
