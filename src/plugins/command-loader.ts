/**
 * Command loader - loads slash commands from plugin command directories
 */

import { readdir, stat } from 'fs/promises';
import { join, basename } from 'path';
import type { CommandDefinition } from './plugin-types.js';
import { parseCommandFile } from './plugin-parser.js';

/**
 * Command registry - stores all loaded plugin commands
 */
export class CommandRegistry {
  private commands: Map<string, CommandDefinition> = new Map();

  /**
   * Register a command
   */
  registerCommand(command: CommandDefinition): void {
    this.commands.set(command.name, command);
  }

  /**
   * Unregister a command
   */
  unregisterCommand(name: string): boolean {
    return this.commands.delete(name);
  }

  /**
   * Get a command by name
   */
  getCommand(name: string): CommandDefinition | undefined {
    return this.commands.get(name);
  }

  /**
   * Get all commands
   */
  getAllCommands(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  /**
   * Check if a command exists
   */
  hasCommand(name: string): boolean {
    return this.commands.has(name);
  }

  /**
   * Clear all commands
   */
  clear(): void {
    this.commands.clear();
  }

  /**
   * Get command names (for autocomplete, help, etc.)
   */
  getCommandNames(): string[] {
    return Array.from(this.commands.keys());
  }
}

/**
 * Load all commands from a plugin's commands directory
 */
export async function loadCommandsFromDirectory(
  commandsDir: string
): Promise<CommandDefinition[]> {
  const commands: CommandDefinition[] = [];

  try {
    const files = await readdir(commandsDir);

    for (const file of files) {
      // Only process .md files
      if (!file.endsWith('.md')) {
        continue;
      }

      const filePath = join(commandsDir, file);
      const fileStat = await stat(filePath);

      if (fileStat.isFile()) {
        try {
          // Command name is filename without .md extension
          const commandName = basename(file, '.md');
          const command = await parseCommandFile(filePath, commandName);
          commands.push(command);
        } catch (error: any) {
          console.error(`Failed to load command from ${filePath}: ${error.message}`);
        }
      }
    }
  } catch (error: any) {
    throw new Error(`Failed to load commands from directory ${commandsDir}: ${error.message}`);
  }

  return commands;
}

/**
 * Global command registry instance
 */
export const commandRegistry = new CommandRegistry();
