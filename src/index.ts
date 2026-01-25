#!/usr/bin/env node

/**
 * Agentic CLI - Main entry point
 * Self-improving autonomous coding assistant
 */

import { Command } from 'commander';
import chalk from 'chalk';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { Agent } from './agent.js';
import { getConfig, ConfigManager } from './config.js';
import { detectProviderType } from './providers/index.js';
import { registerCoreTools } from './tools/index.js';
import { StorageManager } from './storage.js';
import type { Session } from './types.js';
import { randomBytes } from 'crypto';
import { getStartupInfo, getModelBadge } from './banner.js';
import { cleanupSessions } from './session-cleanup.js';
import { join } from 'path';
import { MCPIntegration } from './mcp-integration.js';
import { FatalError, getExitCode, getErrorMessage, getErrorType } from './errors.js';
import { setWindowTitle, computeWindowTitle, resetWindowTitle } from './window-title.js';
import { expandPrompt } from './prompt-expander.js';
import { runHealthCheck } from './health-check.js';
import { checkForUpdates, formatUpdateMessage } from './version-check.js';
import { copyToClipboard } from './clipboard.js';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.js';
import { getWorkspaceWarnings } from './workspace-warnings.js';
import { runDiagnostics, formatDiagnostics } from './doctor.js';
import { createAuthCommand } from './commands/auth.js';

const program = new Command();

/**
 * Run session cleanup on startup (non-blocking)
 */
async function runStartupCleanup(): Promise<void> {
  try {
    const config = getConfig();
    if (!config.sessionCleanup?.enabled) {
      return;
    }

    const sessionsDir = join(config.dataDir, 'sessions');
    await cleanupSessions(sessionsDir, config.sessionCleanup, false);
  } catch (error) {
    // Silently fail - don't let cleanup failures break startup
  }
}

program
  .name('agent')
  .description('Agentic CLI - Autonomous coding and system control')
  .version('0.1.0');

program
  .command('chat')
  .description('Start interactive chat session')
  .option('-a, --auto-approve', 'Auto-approve all tool executions')
  .option('-m, --model <model>', 'Claude model to use')
  .action(async (options) => {
    await startChat(options);
  });

program
  .command('exec <prompt>')
  .description('Execute a single prompt non-interactively')
  .option('-a, --auto-approve', 'Auto-approve all tool executions')
  .option('-m, --model <model>', 'Claude model to use')
  .action(async (prompt, options) => {
    await executePrompt(prompt, options);
  });

program
  .command('config')
  .description('Show current configuration')
  .action(() => {
    const config = getConfig();
    console.log(chalk.bold('Current Configuration:'));
    console.log(chalk.gray('Provider:'), config.provider);
    console.log(chalk.gray('API Key:'), config.apiKey ? '***' + config.apiKey.slice(-4) : 'Not set');
    console.log(chalk.gray('Model:'), config.model);
    console.log(chalk.gray('Max Tokens:'), config.maxTokens);
    console.log(chalk.gray('Temperature:'), config.temperature);
    console.log(chalk.gray('Auto Approve:'), config.autoApprove);
    console.log(chalk.gray('Max Turns:'), config.maxTurns);
    console.log(chalk.gray('Data Dir:'), config.dataDir);
  });

program
  .command('list-sessions')
  .description('List all saved sessions')
  .option('-l, --limit <limit>', 'Number of sessions to show', '10')
  .action((options) => {
    const config = getConfig();
    const storage = new StorageManager(config.dataDir);
    const sessions = storage.listAllSessions();

    if (sessions.length === 0) {
      console.log(chalk.gray('No sessions found.'));
      return;
    }

    console.log(chalk.bold(`Recent Sessions (${sessions.length} total):\n`));

    const limit = parseInt(options.limit);
    for (const session of sessions.slice(0, limit)) {
      const date = new Date(session.createdAt);
      console.log(chalk.cyan(`ID: ${session.id}`));
      console.log(chalk.gray(`  Created: ${date.toLocaleString()}`));
      console.log(chalk.gray(`  Working Dir: ${session.workingDirectory}`));
      console.log(chalk.gray(`  Total Turns: ${session.totalTurns}`));
      console.log('');
    }
  });

program
  .command('resume')
  .description('Resume the most recent session')
  .option('-a, --auto-approve', 'Auto-approve all tool executions')
  .option('-m, --model <model>', 'Claude model to use')
  .action(async (options) => {
    await resumeSession(options);
  });

program
  .command('mcp')
  .description('List configured MCP servers and their status')
  .action(async () => {
    await showMCPStatus();
  });

// Add authentication command
program.addCommand(createAuthCommand());

/**
 * Handle slash commands in the REPL.
 * Returns true if the command was handled, false otherwise.
 */
async function handleSlashCommand(command: string, agent: Agent | null, provider: 'anthropic' | 'deepseek' | 'lmstudio' | 'google', model: string): Promise<boolean> {
  const cmd = command.trim().toLowerCase();

  // /copy - Copy last AI response to clipboard
  if (cmd === '/copy') {
    if (!agent) {
      console.log(chalk.red('✗ This command requires an active AI connection'));
      return true;
    }
    try {
      const messages = agent.getMessages();

      // Find the last assistant message
      const lastAssistantMessage = messages
        .slice()
        .reverse()
        .find((msg) => msg.role === 'assistant');

      if (!lastAssistantMessage) {
        console.log(chalk.gray('No output in history to copy.'));
        return true;
      }

      // Extract text content from the message
      let textContent = '';
      if (Array.isArray(lastAssistantMessage.content)) {
        textContent = lastAssistantMessage.content
          .filter((block) => block.type === 'text')
          .map((block) => (block as any).text)
          .join('');
      } else if (typeof lastAssistantMessage.content === 'string') {
        textContent = lastAssistantMessage.content;
      }

      if (!textContent) {
        console.log(chalk.gray('Last output contains no text to copy.'));
        return true;
      }

      await copyToClipboard(textContent);
      console.log(chalk.green('✓ Last output copied to clipboard'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(chalk.red(`✗ Failed to copy to clipboard: ${message}`));
    }
    return true;
  }

  // /doctor - Run environment diagnostics
  if (cmd === '/doctor') {
    try {
      const results = await runDiagnostics();
      console.log(formatDiagnostics(results));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(chalk.red(`✗ Diagnostics failed: ${message}`));
    }
    return true;
  }

  // /help - Show available commands
  if (cmd === '/help') {
    console.log(chalk.bold('\nAvailable slash commands:'));
    console.log(chalk.cyan('  /copy') + chalk.gray(' - Copy last AI response to clipboard'));
    console.log(chalk.cyan('  /doctor') + chalk.gray(' - Run environment diagnostics'));
    console.log(chalk.cyan('  /skills list') + chalk.gray(' - List all loaded skills'));
    console.log(chalk.cyan('  /skills reload') + chalk.gray(' - Reload all skills'));
    console.log(chalk.cyan('  /skills activate <name>') + chalk.gray(' - Activate a specific skill'));
    console.log(chalk.cyan('  /skills deactivate <name>') + chalk.gray(' - Deactivate a specific skill'));
    console.log(chalk.cyan('  /mcp list') + chalk.gray(' - List configured MCP servers'));
    console.log(chalk.cyan('  /mcp add <name> --transport <type> ...') + chalk.gray(' - Add MCP server'));
    console.log(chalk.cyan('  /mcp get <name>') + chalk.gray(' - Show MCP server details'));
    console.log(chalk.cyan('  /mcp remove <name>') + chalk.gray(' - Remove MCP server'));
    console.log(chalk.cyan('  /plugin marketplace add <source>') + chalk.gray(' - Add a marketplace'));
    console.log(chalk.cyan('  /plugin marketplace browse') + chalk.gray(' - Browse marketplace addons'));
    console.log(chalk.cyan('  /plugin marketplace list') + chalk.gray(' - List configured marketplaces'));
    console.log(chalk.cyan('  /plugin browse') + chalk.gray(' - Browse all available addons'));
    console.log(chalk.cyan('  /plugin install <name|url>') + chalk.gray(' - Install addon'));
    console.log(chalk.cyan('  /plugin list') + chalk.gray(' - List installed addons'));
    console.log(chalk.cyan('  /plugin info <name>') + chalk.gray(' - Show addon details and capabilities'));
    console.log(chalk.cyan('  /plugin enable <name>') + chalk.gray(' - Enable addon MCP servers'));
    console.log(chalk.cyan('  /plugin disable <name>') + chalk.gray(' - Disable addon MCP servers'));
    console.log(chalk.cyan('  /plugin update [name]') + chalk.gray(' - Update addon(s)'));
    console.log(chalk.cyan('  /plugin remove <name>') + chalk.gray(' - Remove addon'));
    console.log(chalk.cyan('  /plugins list') + chalk.gray(' - List loaded plugins (active)'));
    console.log(chalk.cyan('  /plugins commands') + chalk.gray(' - List available plugin commands'));
    console.log(chalk.cyan('  /toolkit list') + chalk.gray(' - List installed toolkits'));
    console.log(chalk.cyan('  /toolkit add <path> [-n name]') + chalk.gray(' - Add a toolkit'));
    console.log(chalk.cyan('  /toolkit remove <name>') + chalk.gray(' - Remove a toolkit'));
    console.log(chalk.cyan('  /toolkit info <name>') + chalk.gray(' - Show toolkit details'));
    console.log(chalk.cyan('  /thinking') + chalk.gray(' - Show the last thinking/reasoning from the model'));
    console.log(chalk.cyan('  /thinking all') + chalk.gray(' - Show all thinking from the session'));
    console.log(chalk.cyan('  /help') + chalk.gray(' - Show this help message'));
    console.log(chalk.cyan('  exit/quit') + chalk.gray(' - Exit the CLI\n'));
    return true;
  }

  // /thinking - Show model thinking/reasoning content (not in context)
  if (cmd === '/thinking' || cmd.startsWith('/thinking ')) {
    if (!agent) {
      console.log(chalk.red('✗ No active session'));
      return true;
    }

    const parts = command.trim().split(/\s+/);
    const subcommand = parts[1]?.toLowerCase();

    if (subcommand === 'all') {
      // Show all thinking from the session
      const allThinking = agent.getAllThinking();
      if (allThinking.length === 0) {
        console.log(chalk.gray('No thinking/reasoning content in this session.'));
        console.log(chalk.gray('Thinking is captured from models that use <think>...</think> tags or reasoning_content.'));
      } else {
        console.log(chalk.bold('\n💭 All Thinking/Reasoning:\n'));
        for (const entry of allThinking) {
          const timestamp = new Date(entry.timestamp).toLocaleTimeString();
          console.log(chalk.yellow(`─── Turn ${entry.turnId} (${timestamp}) ───`));
          console.log(entry.thinking);
          console.log('');
        }
      }
    } else {
      // Show the most recent thinking
      const lastThinking = agent.getLastThinking();
      if (!lastThinking) {
        console.log(chalk.gray('No thinking/reasoning content available.'));
        console.log(chalk.gray('Thinking is captured from models that use <think>...</think> tags or reasoning_content.'));
      } else {
        console.log(chalk.bold('\n💭 Last Thinking/Reasoning:\n'));
        console.log(lastThinking);
        console.log('');
      }
    }
    return true;
  }

  // Check if it's a plugin command first
  if (cmd.startsWith('/')) {
    try {
      const { commandRegistry, substituteCommandArguments } = await import('./plugins/index.js');
      const commandName = cmd.substring(1).split(/\s+/)[0];

      if (commandRegistry.hasCommand(commandName)) {
        if (!agent) {
          console.log(chalk.red('✗ Plugin commands require an active AI connection'));
          return true;
        }
        const commandDef = commandRegistry.getCommand(commandName);
        if (commandDef) {
          // Extract arguments
          const args = command.substring(commandName.length + 2).split(/\s+/).filter(Boolean);

          // Substitute arguments in instructions
          const processedInstructions = substituteCommandArguments(commandDef.instructions, args);

          // Execute as if user sent this message
          console.log(chalk.cyan(`\nExecuting plugin command: ${commandName}\n`));

          // Execute the turn with the command instructions
          const badge = getModelBadge(provider, model);
          console.log(chalk.cyan(`${badge} Assistant: `));
          await agent.executeTurn(processedInstructions);

          return true;
        }
      }
    } catch (error) {
      // Plugin commands not available - continue to other slash commands
    }
  }

  // /skills - Skills management commands
  if (cmd.startsWith('/skills')) {
    try {
      const { skillContextManager, initializeSkills } = await import('./skills/index.js');
      const config = getConfig();
      const parts = command.trim().split(/\s+/);
      const subcommand = parts[1]?.toLowerCase();

      // /skills list - Show all loaded skills
      if (subcommand === 'list' || !subcommand) {
        const skills = skillContextManager.getAllSkills();
        if (skills.length === 0) {
          console.log(chalk.gray('No skills loaded.'));
        } else {
          console.log(chalk.bold('\nLoaded Skills:\n'));
          for (const skill of skills) {
            const status = skill.active ? chalk.green('●') : chalk.gray('○');
            console.log(`${status} ${chalk.bold(skill.metadata.name)}`);
            console.log(chalk.gray(`  ${skill.metadata.description}`));
            if (skill.metadata.license) {
              console.log(chalk.gray(`  License: ${skill.metadata.license}`));
            }
            console.log('');
          }
          const stats = skillContextManager.getStats();
          console.log(chalk.gray(`Total: ${stats.total} | Active: ${stats.active} | Inactive: ${stats.inactive}\n`));
        }
        return true;
      }

      // /skills reload - Reload all skills
      if (subcommand === 'reload') {
        skillContextManager.clear();
        if (config.skills) {
          await initializeSkills(config.skills);
          console.log(chalk.green('✓ Skills reloaded'));
        } else {
          console.log(chalk.gray('No skills configuration found in config.json'));
        }
        return true;
      }

      // /skills activate <name> - Activate a skill
      if (subcommand === 'activate') {
        const skillName = parts.slice(2).join(' ');
        if (!skillName) {
          console.log(chalk.red('✗ Please specify a skill name'));
          return true;
        }
        if (skillContextManager.activateSkill(skillName)) {
          console.log(chalk.green(`✓ Activated skill: ${skillName}`));
        } else {
          console.log(chalk.red(`✗ Skill not found: ${skillName}`));
        }
        return true;
      }

      // /skills deactivate <name> - Deactivate a skill
      if (subcommand === 'deactivate') {
        const skillName = parts.slice(2).join(' ');
        if (!skillName) {
          console.log(chalk.red('✗ Please specify a skill name'));
          return true;
        }
        if (skillContextManager.deactivateSkill(skillName)) {
          console.log(chalk.green(`✓ Deactivated skill: ${skillName}`));
        } else {
          console.log(chalk.red(`✗ Skill not found: ${skillName}`));
        }
        return true;
      }

      // Unknown skills subcommand
      console.log(chalk.red(`✗ Unknown skills command: ${subcommand}`));
      console.log(chalk.gray('Available: list, reload, activate <name>, deactivate <name>'));
      return true;
    } catch (error: any) {
      console.log(chalk.red(`✗ Skills error: ${error.message}`));
      return true;
    }
  }

  // /plugin - Plugin marketplace and installation commands
  if (cmd.startsWith('/plugin ') || cmd === '/plugin') {
    try {
      const { marketplaceManager } = await import('./marketplace/index.js');
      const parts = command.trim().split(/\s+/);
      const subcommand = parts[1]?.toLowerCase();
      const subsubcommand = parts[2]?.toLowerCase();

      // /plugin marketplace - Marketplace commands
      if (subcommand === 'marketplace') {
        // /plugin marketplace add <source>
        if (subsubcommand === 'add') {
          const source = parts.slice(3).join(' ');
          if (!source) {
            console.log(chalk.red('✗ Please specify a marketplace source'));
            console.log(chalk.gray('Examples:'));
            console.log(chalk.gray('  /plugin marketplace add anthropics/claude-code'));
            console.log(chalk.gray('  /plugin marketplace add /path/to/marketplace.json'));
            console.log(chalk.gray('  /plugin marketplace add https://github.com/user/plugins.git'));
            return true;
          }

          console.log(chalk.cyan(`Adding marketplace: ${source}...`));

          // Handle shorthand like "anthropics/claude-code"
          let marketplacePath = source;
          if (!source.startsWith('/') && !source.startsWith('http') && !source.startsWith('git@')) {
            // Assume it's a shorthand, expand it to a local path
            // anthropics/claude-code -> look for it in common locations
            const possiblePaths = [
              `/home/mike/Desktop/Freedom CLI/examples/closed-source-inspiration/cluade_code_addons/claude-plugins-official/.claude-plugin/marketplace.json`,
              `/home/mike/Desktop/Freedom CLI/examples/closed-source-inspiration/cluade_code_addons/skills/.claude-plugin/marketplace.json`,
            ];

            // For now, just use the source as-is and let it fail with helpful error
            marketplacePath = source;
          }

          try {
            await marketplaceManager.addMarketplace(marketplacePath);
            console.log(chalk.green(`✓ Marketplace added successfully`));
          } catch (error: any) {
            console.log(chalk.red(`✗ Failed to add marketplace: ${error.message}`));
            console.log(chalk.gray('\nTip: Use full path to marketplace.json file'));
          }
          return true;
        }

        // /plugin marketplace browse
        if (subsubcommand === 'browse') {
          const { select, confirm } = await import('@inquirer/prompts');

          const marketplaces = marketplaceManager.getAllMarketplaces();
          if (marketplaces.length === 0) {
            console.log(chalk.gray('No marketplaces configured. Add one with /plugin marketplace add <source>'));
            return true;
          }

          // Step 1: Select marketplace
          const marketplaceChoices = marketplaces.map(m => ({
            name: `${m.name} (${m.plugins.length} addons)`,
            value: m.name,
            description: m.metadata?.description || ''
          }));

          const selectedMarketplaceName = await select({
            message: 'Select a marketplace:',
            choices: marketplaceChoices,
          });

          const marketplace = marketplaceManager.getMarketplace(selectedMarketplaceName);
          if (!marketplace || marketplace.plugins.length === 0) {
            console.log(chalk.gray('No addons available in this marketplace'));
            return true;
          }

          // Step 2: Select addon
          const addonChoices = marketplace.plugins.map(entry => ({
            name: entry.name,
            value: entry.name,
            description: entry.description || ''
          }));

          const selectedAddon = await select({
            message: 'Select an addon to install:',
            choices: addonChoices,
          });

          const entry = marketplace.plugins.find(e => e.name === selectedAddon);
          if (!entry) {
            console.log(chalk.red('✗ Addon not found'));
            return true;
          }

          // Step 3: Show details and confirm
          console.log(chalk.bold(`\n${entry.name}`));
          console.log(chalk.gray(entry.description));
          if (entry.category) console.log(chalk.gray(`Category: ${entry.category}`));
          if (entry.version) console.log(chalk.gray(`Version: ${entry.version}`));
          if (entry.homepage) console.log(chalk.gray(`Homepage: ${entry.homepage}`));
          console.log('');

          const shouldInstall = await confirm({
            message: 'Install this addon?',
            default: true,
          });

          if (!shouldInstall) {
            console.log(chalk.gray('Installation cancelled'));
            return true;
          }

          // Step 4: Install
          console.log(chalk.cyan(`\nInstalling ${selectedAddon}...`));
          const result = await marketplaceManager.installAddon(selectedAddon, selectedMarketplaceName);

          if (result.success) {
            console.log(chalk.green(`✓ ${result.message || 'Addon installed successfully'}`));
            if (result.type) console.log(chalk.gray(`  Type: ${result.type}`));
          } else {
            console.log(chalk.red(`✗ ${result.error || 'Installation failed'}`));
          }
          return true;
        }

        // /plugin marketplace list
        if (subsubcommand === 'list' || !subsubcommand) {
          const marketplaces = marketplaceManager.getAllMarketplaces();
          if (marketplaces.length === 0) {
            console.log(chalk.gray('No marketplaces configured.'));
            console.log(chalk.gray('Add one with: /plugin marketplace add <source>'));
          } else {
            console.log(chalk.bold('\nConfigured Marketplaces:\n'));
            for (const marketplace of marketplaces) {
              console.log(chalk.bold(marketplace.name));
              if (marketplace.metadata?.description) {
                console.log(chalk.gray(`  ${marketplace.metadata.description}`));
              }
              console.log(chalk.gray(`  Addons: ${marketplace.plugins.length}`));
              if (marketplace.path) {
                console.log(chalk.gray(`  Path: ${marketplace.path}`));
              }
              console.log('');
            }
          }
          return true;
        }

        console.log(chalk.red(`✗ Unknown marketplace command: ${subsubcommand}`));
        console.log(chalk.gray('Available: add <source>, browse, list'));
        return true;
      }

      // /plugin browse - Browse all addons
      if (subcommand === 'browse') {
        const { select, confirm } = await import('@inquirer/prompts');

        const allAddons = marketplaceManager.listAvailableAddons();
        if (allAddons.length === 0) {
          console.log(chalk.gray('No addons available. Add a marketplace with /plugin marketplace add <source>'));
          return true;
        }

        // Flatten all addons
        const addonChoices: Array<{
          name: string;
          value: { name: string; marketplace: string };
          description: string;
        }> = [];

        for (const { marketplace, entries } of allAddons) {
          for (const entry of entries) {
            const category = entry.category ? `[${entry.category}] ` : '';
            addonChoices.push({
              name: `${entry.name} (from ${marketplace})`,
              value: { name: entry.name, marketplace },
              description: `${category}${entry.description || ''}`
            });
          }
        }

        if (addonChoices.length === 0) {
          console.log(chalk.gray('No addons available'));
          return true;
        }

        const selected = await select({
          message: 'Select an addon to install:',
          choices: addonChoices,
        });

        const marketplaceData = allAddons.find(m => m.marketplace === selected.marketplace);
        const entry = marketplaceData?.entries.find(e => e.name === selected.name);

        if (!entry) {
          console.log(chalk.red('✗ Addon not found'));
          return true;
        }

        // Show details and confirm
        console.log(chalk.bold(`\n${entry.name}`));
        console.log(chalk.gray(entry.description));
        console.log(chalk.gray(`From: ${selected.marketplace}`));
        if (entry.category) console.log(chalk.gray(`Category: ${entry.category}`));
        if (entry.version) console.log(chalk.gray(`Version: ${entry.version}`));
        if (entry.homepage) console.log(chalk.gray(`Homepage: ${entry.homepage}`));
        console.log('');

        const shouldInstall = await confirm({
          message: 'Install this addon?',
          default: true,
        });

        if (!shouldInstall) {
          console.log(chalk.gray('Installation cancelled'));
          return true;
        }

        console.log(chalk.cyan(`\nInstalling ${selected.name}...`));
        const result = await marketplaceManager.installAddon(selected.name, selected.marketplace);

        if (result.success) {
          console.log(chalk.green(`✓ ${result.message || 'Addon installed successfully'}`));
          if (result.type) console.log(chalk.gray(`  Type: ${result.type}`));
          if (result.path) console.log(chalk.gray(`  Path: ${result.path}`));
        } else {
          console.log(chalk.red(`✗ ${result.error || 'Installation failed'}`));
        }
        return true;
      }

      // /plugin install <name|url>
      if (subcommand === 'install') {
        const addonName = parts.slice(2).join(' ');
        if (!addonName) {
          console.log(chalk.red('✗ Please specify addon name or git URL'));
          return true;
        }

        // Check if it's a git URL
        if (addonName.startsWith('http://') || addonName.startsWith('https://') || addonName.startsWith('git@')) {
          console.log(chalk.cyan(`Installing from git: ${addonName}...`));
          const result = await marketplaceManager.installFromGit(addonName);

          if (result.success) {
            console.log(chalk.green(`✓ ${result.message}`));
            console.log(chalk.gray(`  Type: ${result.type}`));
            console.log(chalk.gray(`  Path: ${result.path}`));
          } else {
            console.log(chalk.red(`✗ ${result.error}`));
          }
        } else {
          console.log(chalk.cyan(`Installing ${addonName} from marketplace...`));
          const result = await marketplaceManager.installAddon(addonName);

          if (result.success) {
            console.log(chalk.green(`✓ ${result.message}`));
            console.log(chalk.gray(`  Type: ${result.type}`));
            console.log(chalk.gray(`  Path: ${result.path}`));
          } else {
            console.log(chalk.red(`✗ ${result.error}`));
          }
        }
        return true;
      }

      // /plugin list
      if (subcommand === 'list' || !subcommand) {
        const installed = await marketplaceManager.listInstalledAddons();
        if (installed.length === 0) {
          console.log(chalk.gray('No plugins installed.'));
        } else {
          console.log(chalk.bold('\nInstalled Plugins:\n'));
          for (const addon of installed) {
            const typeLabel = addon.type === 'git' ? '(git)' : '(local)';
            console.log(chalk.bold(`${addon.name} `) + chalk.gray(typeLabel));
            console.log(chalk.gray(`  Path: ${addon.path}`));
            if (addon.sourceUrl) {
              console.log(chalk.gray(`  Source: ${addon.sourceUrl}`));
            }
            console.log('');
          }
        }
        return true;
      }

      // /plugin update [name]
      if (subcommand === 'update') {
        const addonName = parts.slice(2).join(' ');

        if (addonName) {
          console.log(chalk.cyan(`Updating ${addonName}...`));
          const result = await marketplaceManager.updateAddon(addonName);

          if (result.success) {
            console.log(chalk.green(`✓ ${result.message}`));
          } else {
            console.log(chalk.red(`✗ ${result.error}`));
          }
        } else {
          console.log(chalk.cyan('Updating all plugins...'));
          const results = await marketplaceManager.updateAllAddons();

          let successCount = 0;
          let failCount = 0;

          for (const result of results) {
            if (result.success) {
              successCount++;
              console.log(chalk.green(`✓ ${result.name}: ${result.message}`));
            } else {
              failCount++;
              console.log(chalk.red(`✗ ${result.name}: ${result.error}`));
            }
          }

          console.log(chalk.gray(`\n${successCount} updated, ${failCount} failed`));
        }
        return true;
      }

      // /plugin remove <name>
      if (subcommand === 'remove') {
        const addonName = parts.slice(2).join(' ');
        if (!addonName) {
          console.log(chalk.red('✗ Please specify addon name'));
          return true;
        }

        console.log(chalk.cyan(`Removing ${addonName}...`));
        const result = await marketplaceManager.removeAddon(addonName);

        if (result.success) {
          console.log(chalk.green(`✓ ${result.message}`));
        } else {
          console.log(chalk.red(`✗ ${result.error}`));
        }
        return true;
      }

      // /plugin info <name>
      if (subcommand === 'info') {
        const addonName = parts.slice(2).join(' ');
        if (!addonName) {
          console.log(chalk.red('✗ Please specify addon name'));
          return true;
        }

        const { readFile } = await import('fs/promises');
        const { existsSync } = await import('fs');
        const { join } = await import('path');

        // Find the installed addon
        const installed = await marketplaceManager.listInstalledAddons();
        const addon = installed.find(a => a.name.toLowerCase() === addonName.toLowerCase());

        if (!addon) {
          console.log(chalk.red(`✗ Addon '${addonName}' is not installed`));
          return true;
        }

        console.log(chalk.bold(`\n${addon.name}`));
        console.log(chalk.gray(`Path: ${addon.path}`));
        if (addon.sourceUrl) {
          console.log(chalk.gray(`Source: ${addon.sourceUrl}`));
        }
        console.log('');

        // Check for .mcp.json
        const mcpJsonPath = join(addon.path, '.mcp.json');
        if (existsSync(mcpJsonPath)) {
          try {
            const mcpContent = await readFile(mcpJsonPath, 'utf-8');
            const mcpConfig = JSON.parse(mcpContent);

            console.log(chalk.bold('MCP Servers:'));
            for (const [serverName, serverConfig] of Object.entries(mcpConfig)) {
              console.log(chalk.cyan(`  ${serverName}`));
              const config = serverConfig as any;
              if (config.command) {
                console.log(chalk.gray(`    Command: ${config.command} ${(config.args || []).join(' ')}`));
              }
              if (config.env) {
                console.log(chalk.gray(`    Environment variables required:`));
                for (const envKey of Object.keys(config.env)) {
                  console.log(chalk.gray(`      - ${envKey}`));
                }
              }
            }
            console.log('');
          } catch (error: any) {
            console.log(chalk.yellow(`⚠ Failed to read MCP configuration: ${error.message}`));
          }
        }

        // Check for plugin.json
        const pluginJsonPath = join(addon.path, '.claude-plugin', 'plugin.json');
        if (existsSync(pluginJsonPath)) {
          try {
            const pluginContent = await readFile(pluginJsonPath, 'utf-8');
            const pluginConfig = JSON.parse(pluginContent);

            if (pluginConfig.description) {
              console.log(chalk.gray(pluginConfig.description));
              console.log('');
            }

            if (pluginConfig.commands && pluginConfig.commands.length > 0) {
              console.log(chalk.bold('Commands:'));
              for (const cmd of pluginConfig.commands) {
                console.log(chalk.cyan(`  /${cmd.name}`) + (cmd.description ? chalk.gray(` - ${cmd.description}`) : ''));
              }
              console.log('');
            }

            if (pluginConfig.agents && pluginConfig.agents.length > 0) {
              console.log(chalk.bold('Agents:'));
              for (const agent of pluginConfig.agents) {
                console.log(chalk.cyan(`  ${agent.name}`) + (agent.description ? chalk.gray(` - ${agent.description}`) : ''));
              }
              console.log('');
            }
          } catch (error: any) {
            console.log(chalk.yellow(`⚠ Failed to read plugin configuration: ${error.message}`));
          }
        }

        return true;
      }

      // /plugin enable <name>
      if (subcommand === 'enable') {
        const addonName = parts.slice(2).join(' ');
        if (!addonName) {
          console.log(chalk.red('✗ Please specify addon name'));
          return true;
        }

        const { readFile, writeFile } = await import('fs/promises');
        const { existsSync } = await import('fs');
        const { join } = await import('path');
        const { updateConfig } = await import('./config.js');

        // Find the installed addon
        const installed = await marketplaceManager.listInstalledAddons();
        const addon = installed.find(a => a.name.toLowerCase() === addonName.toLowerCase());

        if (!addon) {
          console.log(chalk.red(`✗ Addon '${addonName}' is not installed`));
          return true;
        }

        // Check for .mcp.json
        const mcpJsonPath = join(addon.path, '.mcp.json');
        if (!existsSync(mcpJsonPath)) {
          console.log(chalk.yellow(`⚠ This addon does not provide MCP servers`));
          return true;
        }

        try {
          const mcpContent = await readFile(mcpJsonPath, 'utf-8');
          const mcpConfig = JSON.parse(mcpContent);

          // Load current config
          const config = getConfig();

          // Merge MCP servers into config
          const currentMcpServers = config.mcpServers || {};
          const updatedMcpServers = { ...currentMcpServers, ...mcpConfig };

          // Update config
          await updateConfig({ mcpServers: updatedMcpServers });

          const serverNames = Object.keys(mcpConfig);
          console.log(chalk.green(`✓ Enabled MCP server(s): ${serverNames.join(', ')}`));
          console.log(chalk.gray('Restart the CLI for changes to take effect'));
        } catch (error: any) {
          console.log(chalk.red(`✗ Failed to enable plugin: ${error.message}`));
        }

        return true;
      }

      // /plugin disable <name>
      if (subcommand === 'disable') {
        const addonName = parts.slice(2).join(' ');
        if (!addonName) {
          console.log(chalk.red('✗ Please specify addon name'));
          return true;
        }

        const { readFile, writeFile } = await import('fs/promises');
        const { existsSync } = await import('fs');
        const { join } = await import('path');
        const { updateConfig } = await import('./config.js');

        // Find the installed addon
        const installed = await marketplaceManager.listInstalledAddons();
        const addon = installed.find(a => a.name.toLowerCase() === addonName.toLowerCase());

        if (!addon) {
          console.log(chalk.red(`✗ Addon '${addonName}' is not installed`));
          return true;
        }

        // Check for .mcp.json
        const mcpJsonPath = join(addon.path, '.mcp.json');
        if (!existsSync(mcpJsonPath)) {
          console.log(chalk.yellow(`⚠ This addon does not provide MCP servers`));
          return true;
        }

        try {
          const mcpContent = await readFile(mcpJsonPath, 'utf-8');
          const mcpConfig = JSON.parse(mcpContent);

          // Load current config
          const config = getConfig();

          // Remove MCP servers from config
          const currentMcpServers = { ...(config.mcpServers || {}) };
          const serverNames = Object.keys(mcpConfig);

          for (const serverName of serverNames) {
            delete currentMcpServers[serverName];
          }

          // Update config
          await updateConfig({ mcpServers: currentMcpServers });

          console.log(chalk.green(`✓ Disabled MCP server(s): ${serverNames.join(', ')}`));
          console.log(chalk.gray('Restart the CLI for changes to take effect'));
        } catch (error: any) {
          console.log(chalk.red(`✗ Failed to disable plugin: ${error.message}`));
        }

        return true;
      }

      console.log(chalk.red(`✗ Unknown plugin command: ${subcommand}`));
      console.log(chalk.gray('Available commands:'));
      console.log(chalk.gray('  /plugin marketplace add <source>'));
      console.log(chalk.gray('  /plugin marketplace browse'));
      console.log(chalk.gray('  /plugin marketplace list'));
      console.log(chalk.gray('  /plugin browse'));
      console.log(chalk.gray('  /plugin install <name|url>'));
      console.log(chalk.gray('  /plugin list'));
      console.log(chalk.gray('  /plugin info <name>'));
      console.log(chalk.gray('  /plugin enable <name>'));
      console.log(chalk.gray('  /plugin disable <name>'));
      console.log(chalk.gray('  /plugin update [name]'));
      console.log(chalk.gray('  /plugin remove <name>'));
      return true;
    } catch (error: any) {
      console.log(chalk.red(`✗ Plugin error: ${error.message}`));
      return true;
    }
  }

  // /plugins - Plugin management commands
  if (cmd.startsWith('/plugins')) {
    try {
      const { pluginManager, initializePlugins, commandRegistry } = await import('./plugins/index.js');
      const config = getConfig();
      const parts = command.trim().split(/\s+/);
      const subcommand = parts[1]?.toLowerCase();

      // /plugins list - Show all loaded plugins
      if (subcommand === 'list' || !subcommand) {
        const plugins = pluginManager.getAllPlugins();
        if (plugins.length === 0) {
          console.log(chalk.gray('No plugins loaded.'));
        } else {
          console.log(chalk.bold('\nLoaded Plugins:\n'));
          for (const plugin of plugins) {
            const status = plugin.active ? chalk.green('●') : chalk.gray('○');
            console.log(`${status} ${chalk.bold(plugin.manifest.name)}`);
            if (plugin.manifest.description) {
              console.log(chalk.gray(`  ${plugin.manifest.description}`));
            }
            if (plugin.manifest.version) {
              console.log(chalk.gray(`  Version: ${plugin.manifest.version}`));
            }

            // Show components
            if (plugin.commands.size > 0) {
              console.log(chalk.gray(`  Commands: ${Array.from(plugin.commands.keys()).join(', ')}`));
            }
            if (plugin.agents.size > 0) {
              console.log(chalk.gray(`  Agents: ${Array.from(plugin.agents.keys()).join(', ')}`));
            }
            if (plugin.hooks.length > 0) {
              console.log(chalk.gray(`  Hooks: ${plugin.hooks.length}`));
            }
            console.log('');
          }

          const stats = pluginManager.getStats();
          console.log(chalk.gray(`Total: ${stats.totalPlugins} | Commands: ${stats.totalCommands} | Agents: ${stats.totalAgents} | Hooks: ${stats.totalHooks}\n`));
        }
        return true;
      }

      // /plugins reload - Reload all plugins
      if (subcommand === 'reload') {
        pluginManager.clear();
        if (config.plugins) {
          await initializePlugins(config.plugins);
          console.log(chalk.green('✓ Plugins reloaded'));
        } else {
          console.log(chalk.gray('No plugins configuration found in config.json'));
        }
        return true;
      }

      // /plugins commands - List all plugin commands
      if (subcommand === 'commands') {
        const commands = commandRegistry.getAllCommands();
        if (commands.length === 0) {
          console.log(chalk.gray('No plugin commands loaded.'));
        } else {
          console.log(chalk.bold('\nAvailable Plugin Commands:\n'));
          for (const command of commands) {
            console.log(chalk.cyan(`  /${command.name}`) + (command.argumentHint ? chalk.gray(` ${command.argumentHint}`) : ''));
            console.log(chalk.gray(`    ${command.description}`));
          }
          console.log('');
        }
        return true;
      }

      // Unknown plugins subcommand
      console.log(chalk.red(`✗ Unknown plugins command: ${subcommand}`));
      console.log(chalk.gray('Available: list, reload, commands'));
      return true;
    } catch (error: any) {
      console.log(chalk.red(`✗ Plugins error: ${error.message}`));
      return true;
    }
  }

  // /mcp - MCP server management commands
  if (cmd.startsWith('/mcp')) {
    try {
      const parts = command.trim().split(/\s+/);
      const subcommand = parts[1]?.toLowerCase();

      // /mcp list - Show all configured MCP servers
      if (subcommand === 'list' || !subcommand) {
        const config = getConfig();
        const mcpServers = config.mcpServers || {};

        if (Object.keys(mcpServers).length === 0) {
          console.log(chalk.gray('No MCP servers configured.'));
          console.log(chalk.gray('Add one with: /mcp add <name> --transport <type> <url|command>'));
          return true;
        }

        console.log(chalk.bold('\nConfigured MCP Servers:\n'));
        for (const [name, serverConfig] of Object.entries(mcpServers)) {
          const config = serverConfig as any;
          console.log(chalk.cyan(`● ${name}`));

          if (config.command) {
            console.log(chalk.gray(`  Transport: stdio`));
            console.log(chalk.gray(`  Command: ${config.command} ${(config.args || []).join(' ')}`));
          } else if (config.url) {
            const transport = config.url.includes('/sse') ? 'sse' : 'http';
            console.log(chalk.gray(`  Transport: ${transport}`));
            console.log(chalk.gray(`  URL: ${config.url}`));
          }

          if (config.env && Object.keys(config.env).length > 0) {
            console.log(chalk.gray(`  Environment: ${Object.keys(config.env).join(', ')}`));
          }
          console.log('');
        }
        return true;
      }

      // /mcp add - Add an MCP server
      if (subcommand === 'add') {
        const { updateConfig } = await import('./config.js');

        // Parse arguments
        let i = 2;
        const serverName = parts[i++];
        if (!serverName) {
          console.log(chalk.red('✗ Please specify a server name'));
          console.log(chalk.gray('Usage: /mcp add <name> --transport <http|sse|stdio> [options] <url|command>'));
          return true;
        }

        let transport: string | undefined;
        let url: string | undefined;
        let command: string | undefined;
        const args: string[] = [];
        const env: Record<string, string> = {};
        const headers: Record<string, string> = {};
        let scope = 'local'; // default scope

        while (i < parts.length) {
          const arg = parts[i];

          if (arg === '--transport') {
            transport = parts[++i];
          } else if (arg === '--env') {
            const envPair = parts[++i];
            const [key, value] = envPair.split('=');
            if (key && value) {
              env[key] = value;
            }
          } else if (arg === '--header') {
            const headerPair = parts[++i];
            const [key, value] = headerPair.split(':', 2);
            if (key && value) {
              headers[key.trim()] = value.trim();
            }
          } else if (arg === '--scope') {
            scope = parts[++i];
          } else if (arg === '--') {
            // Everything after -- is the command and args
            command = parts[++i];
            while (i + 1 < parts.length) {
              args.push(parts[++i]);
            }
            break;
          } else if (!url && !command) {
            // First non-flag argument is URL or command
            if (transport === 'http' || transport === 'sse') {
              url = arg;
            } else if (transport === 'stdio') {
              command = arg;
            }
          } else if (transport === 'stdio') {
            // Additional arguments for stdio command
            args.push(arg);
          }
          i++;
        }

        if (!transport) {
          console.log(chalk.red('✗ Please specify --transport <http|sse|stdio>'));
          return true;
        }

        const config = getConfig();
        const mcpServers = { ...(config.mcpServers || {}) };

        if (transport === 'http' || transport === 'sse') {
          if (!url) {
            console.log(chalk.red('✗ Please specify a URL for HTTP/SSE transport'));
            return true;
          }

          mcpServers[serverName] = {
            url,
            ...(Object.keys(headers).length > 0 && { headers }),
            ...(Object.keys(env).length > 0 && { env })
          };
        } else if (transport === 'stdio') {
          if (!command) {
            console.log(chalk.red('✗ Please specify a command for stdio transport'));
            return true;
          }

          mcpServers[serverName] = {
            command,
            ...(args.length > 0 && { args }),
            ...(Object.keys(env).length > 0 && { env })
          };
        } else {
          console.log(chalk.red(`✗ Unknown transport: ${transport}`));
          console.log(chalk.gray('Supported transports: http, sse, stdio'));
          return true;
        }

        await updateConfig({ mcpServers });

        console.log(chalk.green(`✓ Added MCP server: ${serverName}`));
        console.log(chalk.gray('Restart the CLI for changes to take effect'));
        return true;
      }

      // /mcp get - Show details for a specific server
      if (subcommand === 'get') {
        const serverName = parts.slice(2).join(' ');
        if (!serverName) {
          console.log(chalk.red('✗ Please specify a server name'));
          return true;
        }

        const config = getConfig();
        const mcpServers = config.mcpServers || {};
        const serverConfig = mcpServers[serverName];

        if (!serverConfig) {
          console.log(chalk.red(`✗ MCP server '${serverName}' not found`));
          return true;
        }

        console.log(chalk.bold(`\n${serverName}`));
        const config2 = serverConfig as any;

        if (config2.command) {
          console.log(chalk.gray('Transport: stdio'));
          console.log(chalk.gray(`Command: ${config2.command}`));
          if (config2.args) {
            console.log(chalk.gray(`Arguments: ${config2.args.join(' ')}`));
          }
        } else if (config2.url) {
          const transport = config2.url.includes('/sse') ? 'sse' : 'http';
          console.log(chalk.gray(`Transport: ${transport}`));
          console.log(chalk.gray(`URL: ${config2.url}`));
        }

        if (config2.env) {
          console.log(chalk.gray('\nEnvironment Variables:'));
          for (const [key, value] of Object.entries(config2.env)) {
            console.log(chalk.gray(`  ${key}=${value}`));
          }
        }

        if (config2.headers) {
          console.log(chalk.gray('\nHeaders:'));
          for (const [key, value] of Object.entries(config2.headers)) {
            console.log(chalk.gray(`  ${key}: ${value}`));
          }
        }
        console.log('');
        return true;
      }

      // /mcp remove - Remove an MCP server
      if (subcommand === 'remove') {
        const serverName = parts.slice(2).join(' ');
        if (!serverName) {
          console.log(chalk.red('✗ Please specify a server name'));
          return true;
        }

        const { updateConfig } = await import('./config.js');
        const config = getConfig();
        const mcpServers = { ...(config.mcpServers || {}) };

        if (!mcpServers[serverName]) {
          console.log(chalk.red(`✗ MCP server '${serverName}' not found`));
          return true;
        }

        delete mcpServers[serverName];
        await updateConfig({ mcpServers });

        console.log(chalk.green(`✓ Removed MCP server: ${serverName}`));
        console.log(chalk.gray('Restart the CLI for changes to take effect'));
        return true;
      }

      console.log(chalk.red(`✗ Unknown mcp command: ${subcommand}`));
      console.log(chalk.gray('Available commands:'));
      console.log(chalk.gray('  /mcp list'));
      console.log(chalk.gray('  /mcp add <name> --transport <http|sse|stdio> [options] <url|command>'));
      console.log(chalk.gray('  /mcp get <name>'));
      console.log(chalk.gray('  /mcp remove <name>'));
      return true;
    } catch (error: any) {
      console.log(chalk.red(`✗ MCP error: ${error.message}`));
      return true;
    }
  }

  // /marketplace - Marketplace management commands
  if (cmd.startsWith('/marketplace')) {
    try {
      const { marketplaceManager } = await import('./marketplace/index.js');
      const parts = command.trim().split(/\s+/);
      const subcommand = parts[1]?.toLowerCase();

      // /marketplace list - Show all marketplaces
      if (subcommand === 'list' || !subcommand) {
        const marketplaces = marketplaceManager.getAllMarketplaces();
        if (marketplaces.length === 0) {
          console.log(chalk.gray('No marketplaces configured.'));
        } else {
          console.log(chalk.bold('\nConfigured Marketplaces:\n'));
          for (const marketplace of marketplaces) {
            console.log(chalk.bold(marketplace.name));
            if (marketplace.metadata?.description) {
              console.log(chalk.gray(`  ${marketplace.metadata.description}`));
            }
            console.log(chalk.gray(`  Addons: ${marketplace.plugins.length}`));
            if (marketplace.path) {
              console.log(chalk.gray(`  Path: ${marketplace.path}`));
            }
            console.log('');
          }
        }
        return true;
      }

      // /marketplace search <query> - Search all marketplaces
      if (subcommand === 'search') {
        const query = parts.slice(2).join(' ');
        if (!query) {
          console.log(chalk.red('✗ Please provide a search query'));
          return true;
        }

        const results = marketplaceManager.searchAllMarketplaces(query);
        if (results.length === 0) {
          console.log(chalk.gray(`No addons found matching '${query}'`));
        } else {
          console.log(chalk.bold(`\nSearch results for '${query}':\n`));
          for (const { marketplace, entries } of results) {
            console.log(chalk.bold(`From ${marketplace.name}:`));
            for (const entry of entries) {
              console.log(chalk.cyan(`  ${entry.name}`));
              console.log(chalk.gray(`    ${entry.description}`));
            }
            console.log('');
          }
        }
        return true;
      }

      // /marketplace browse - Interactive marketplace browser
      if (subcommand === 'browse') {
        const { select, confirm } = await import('@inquirer/prompts');

        const marketplaces = marketplaceManager.getAllMarketplaces();
        if (marketplaces.length === 0) {
          console.log(chalk.gray('No marketplaces configured. Add one with /marketplace add <path>'));
          return true;
        }

        // Step 1: Select marketplace
        const marketplaceChoices = marketplaces.map(m => ({
          name: `${m.name} (${m.plugins.length} addons)`,
          value: m.name,
          description: m.metadata?.description || ''
        }));

        const selectedMarketplaceName = await select({
          message: 'Select a marketplace:',
          choices: marketplaceChoices,
        });

        const marketplace = marketplaceManager.getMarketplace(selectedMarketplaceName);
        if (!marketplace) {
          console.log(chalk.red('✗ Marketplace not found'));
          return true;
        }

        // Step 2: Select addon
        if (marketplace.plugins.length === 0) {
          console.log(chalk.gray('No addons available in this marketplace'));
          return true;
        }

        const addonChoices = marketplace.plugins.map(entry => ({
          name: entry.name,
          value: entry.name,
          description: entry.description || ''
        }));

        const selectedAddon = await select({
          message: 'Select an addon to install:',
          choices: addonChoices,
        });

        const entry = marketplace.plugins.find(e => e.name === selectedAddon);
        if (!entry) {
          console.log(chalk.red('✗ Addon not found'));
          return true;
        }

        // Step 3: Show details and confirm
        console.log(chalk.bold(`\n${entry.name}`));
        console.log(chalk.gray(entry.description));
        if (entry.category) {
          console.log(chalk.gray(`Category: ${entry.category}`));
        }
        if (entry.version) {
          console.log(chalk.gray(`Version: ${entry.version}`));
        }
        if (entry.homepage) {
          console.log(chalk.gray(`Homepage: ${entry.homepage}`));
        }
        console.log('');

        const shouldInstall = await confirm({
          message: 'Install this addon?',
          default: true,
        });

        if (!shouldInstall) {
          console.log(chalk.gray('Installation cancelled'));
          return true;
        }

        // Step 4: Install
        console.log(chalk.cyan(`\nInstalling ${selectedAddon}...`));
        const result = await marketplaceManager.installAddon(selectedAddon, selectedMarketplaceName);

        if (result.success) {
          console.log(chalk.green(`✓ ${result.message || 'Addon installed successfully'}`));
          if (result.type) {
            console.log(chalk.gray(`  Type: ${result.type}`));
          }
        } else {
          console.log(chalk.red(`✗ ${result.error || 'Installation failed'}`));
        }

        return true;
      }

      // Unknown marketplace subcommand
      console.log(chalk.red(`✗ Unknown marketplace command: ${subcommand}`));
      console.log(chalk.gray('Available: list, search <query>, browse'));
      return true;
    } catch (error: any) {
      console.log(chalk.red(`✗ Marketplace error: ${error.message}`));
      return true;
    }
  }

  // /addon - Addon installation and management
  if (cmd.startsWith('/addon')) {
    try {
      const { marketplaceManager } = await import('./marketplace/index.js');
      const parts = command.trim().split(/\s+/);
      const subcommand = parts[1]?.toLowerCase();

      // /addon list - Show installed addons
      if (subcommand === 'list' || !subcommand) {
        const installed = await marketplaceManager.listInstalledAddons();
        if (installed.length === 0) {
          console.log(chalk.gray('No addons installed.'));
        } else {
          console.log(chalk.bold('\nInstalled Addons:\n'));
          for (const addon of installed) {
            const typeLabel = addon.type === 'git' ? '(git)' : '(local)';
            console.log(chalk.cyan(addon.name) + ' ' + chalk.gray(typeLabel));
            console.log(chalk.gray(`  Path: ${addon.path}`));
            if (addon.sourceUrl) {
              console.log(chalk.gray(`  Source: ${addon.sourceUrl}`));
            }
            if (addon.marketplace) {
              console.log(chalk.gray(`  Marketplace: ${addon.marketplace}`));
            }
            console.log('');
          }
          console.log(chalk.gray(`Total: ${installed.length}`));
        }
        return true;
      }

      // /addon install <name> - Install from marketplace
      if (subcommand === 'install') {
        const addonName = parts.slice(2).join(' ');
        if (!addonName) {
          console.log(chalk.red('✗ Please specify addon name or git URL'));
          return true;
        }

        // Check if it's a git URL
        if (
          addonName.startsWith('http://') ||
          addonName.startsWith('https://') ||
          addonName.startsWith('git@')
        ) {
          console.log(chalk.cyan(`Installing from git: ${addonName}...`));
          const result = await marketplaceManager.installFromGit(addonName);

          if (result.success) {
            console.log(chalk.green(`✓ ${result.message}`));
            console.log(chalk.gray(`  Type: ${result.type}`));
            console.log(chalk.gray(`  Path: ${result.path}`));
          } else {
            console.log(chalk.red(`✗ ${result.error}`));
          }
        } else {
          // Install from marketplace
          console.log(chalk.cyan(`Installing ${addonName} from marketplace...`));
          const result = await marketplaceManager.installAddon(addonName);

          if (result.success) {
            console.log(chalk.green(`✓ ${result.message}`));
            console.log(chalk.gray(`  Type: ${result.type}`));
            console.log(chalk.gray(`  Path: ${result.path}`));
          } else {
            console.log(chalk.red(`✗ ${result.error}`));
          }
        }
        return true;
      }

      // /addon update [name] - Update addon(s)
      if (subcommand === 'update') {
        const addonName = parts.slice(2).join(' ');

        if (addonName) {
          // Update specific addon
          console.log(chalk.cyan(`Updating ${addonName}...`));
          const result = await marketplaceManager.updateAddon(addonName);

          if (result.success) {
            console.log(chalk.green(`✓ ${result.message}`));
          } else {
            console.log(chalk.red(`✗ ${result.error}`));
          }
        } else {
          // Update all addons
          console.log(chalk.cyan('Updating all addons...'));
          const results = await marketplaceManager.updateAllAddons();

          let successCount = 0;
          let failCount = 0;

          for (const result of results) {
            if (result.success) {
              console.log(chalk.green(`✓ ${result.name}: ${result.message}`));
              successCount++;
            } else {
              console.log(chalk.red(`✗ ${result.name}: ${result.error}`));
              failCount++;
            }
          }

          console.log(chalk.gray(`\nUpdated: ${successCount} | Failed: ${failCount}`));
        }
        return true;
      }

      // /addon remove <name> - Remove addon
      if (subcommand === 'remove') {
        const addonName = parts.slice(2).join(' ');
        if (!addonName) {
          console.log(chalk.red('✗ Please specify addon name'));
          return true;
        }

        const result = await marketplaceManager.removeAddon(addonName);

        if (result.success) {
          console.log(chalk.green(`✓ ${result.message}`));
        } else {
          console.log(chalk.red(`✗ ${result.error}`));
        }
        return true;
      }

      // /addon search <query> - Search marketplaces
      if (subcommand === 'search') {
        const query = parts.slice(2).join(' ');
        if (!query) {
          console.log(chalk.red('✗ Please provide a search query'));
          return true;
        }

        const results = marketplaceManager.searchAllMarketplaces(query);
        if (results.length === 0) {
          console.log(chalk.gray(`No addons found matching '${query}'`));
        } else {
          console.log(chalk.bold(`\nSearch results for '${query}':\n`));
          for (const { marketplace, entries } of results) {
            console.log(chalk.bold(`From ${marketplace.name}:`));
            for (const entry of entries) {
              console.log(chalk.cyan(`  ${entry.name}`));
              console.log(chalk.gray(`    ${entry.description}`));
              if (entry.category) {
                console.log(chalk.gray(`    Category: ${entry.category}`));
              }
            }
            console.log('');
          }
        }
        return true;
      }

      // /addon browse - Interactive addon browser (all marketplaces)
      if (subcommand === 'browse') {
        const { select, confirm } = await import('@inquirer/prompts');

        const allAddons = marketplaceManager.listAvailableAddons();
        if (allAddons.length === 0) {
          console.log(chalk.gray('No addons available. Add a marketplace with /marketplace add <path>'));
          return true;
        }

        // Flatten all addons with marketplace info
        const addonChoices: Array<{
          name: string;
          value: { name: string; marketplace: string };
          description: string;
        }> = [];

        for (const { marketplace, entries } of allAddons) {
          for (const entry of entries) {
            const category = entry.category ? `[${entry.category}] ` : '';
            addonChoices.push({
              name: `${entry.name} (from ${marketplace})`,
              value: { name: entry.name, marketplace },
              description: `${category}${entry.description || ''}`
            });
          }
        }

        if (addonChoices.length === 0) {
          console.log(chalk.gray('No addons available'));
          return true;
        }

        // Select addon
        const selected = await select({
          message: 'Select an addon to install:',
          choices: addonChoices,
        });

        // Find the entry
        const marketplaceData = allAddons.find(m => m.marketplace === selected.marketplace);
        const entry = marketplaceData?.entries.find(e => e.name === selected.name);

        if (!entry) {
          console.log(chalk.red('✗ Addon not found'));
          return true;
        }

        // Show details and confirm
        console.log(chalk.bold(`\n${entry.name}`));
        console.log(chalk.gray(entry.description));
        console.log(chalk.gray(`From: ${selected.marketplace}`));
        if (entry.category) {
          console.log(chalk.gray(`Category: ${entry.category}`));
        }
        if (entry.version) {
          console.log(chalk.gray(`Version: ${entry.version}`));
        }
        if (entry.homepage) {
          console.log(chalk.gray(`Homepage: ${entry.homepage}`));
        }
        console.log('');

        const shouldInstall = await confirm({
          message: 'Install this addon?',
          default: true,
        });

        if (!shouldInstall) {
          console.log(chalk.gray('Installation cancelled'));
          return true;
        }

        // Install
        console.log(chalk.cyan(`\nInstalling ${selected.name}...`));
        const result = await marketplaceManager.installAddon(selected.name, selected.marketplace);

        if (result.success) {
          console.log(chalk.green(`✓ ${result.message || 'Addon installed successfully'}`));
          if (result.type) {
            console.log(chalk.gray(`  Type: ${result.type}`));
          }
          if (result.path) {
            console.log(chalk.gray(`  Path: ${result.path}`));
          }
        } else {
          console.log(chalk.red(`✗ ${result.error || 'Installation failed'}`));
        }

        return true;
      }

      // Unknown addon subcommand
      console.log(chalk.red(`✗ Unknown addon command: ${subcommand}`));
      console.log(chalk.gray('Available: list, browse, install <name|url>, update [name], remove <name>, search <query>'));
      return true;
    } catch (error: any) {
      console.log(chalk.red(`✗ Addon error: ${error.message}`));
      return true;
    }
  }

  // /toolkit - Toolkit management commands
  if (cmd.startsWith('/toolkit')) {
    try {
      const { toolkitManager } = await import('./toolkit/index.js');
      const parts = command.trim().split(/\s+/);
      const subcommand = parts[1]?.toLowerCase();

      // /toolkit list - Show installed toolkits
      if (subcommand === 'list' || !subcommand) {
        const toolkits = await toolkitManager.listToolkits();
        if (toolkits.length === 0) {
          console.log(chalk.gray('No toolkits installed.'));
          console.log(chalk.gray('Add one with: /toolkit add <path> [-n name]'));
        } else {
          console.log(chalk.bold('\nInstalled Toolkits:\n'));
          for (const toolkit of toolkits) {
            console.log(chalk.cyan(`● ${toolkit.name}`));
            if (toolkit.description) {
              console.log(chalk.gray(`  ${toolkit.description}`));
            }
            console.log(chalk.gray(`  Path: ${toolkit.path}`));
            console.log(chalk.gray(`  Source: ${toolkit.sourcePath}`));
            console.log('');
          }
          console.log(chalk.gray(`Total: ${toolkits.length}`));
        }
        return true;
      }

      // /toolkit add <path> [-n name] - Add a toolkit
      if (subcommand === 'add') {
        // Parse arguments: /toolkit add <path> [-n name]
        let sourcePath: string | undefined;
        let customName: string | undefined;

        // Find -n flag position
        const nFlagIndex = parts.indexOf('-n');
        if (nFlagIndex !== -1 && nFlagIndex < parts.length - 1) {
          // Get custom name (everything after -n)
          customName = parts.slice(nFlagIndex + 1).join(' ');
          // Get source path (everything between 'add' and '-n')
          sourcePath = parts.slice(2, nFlagIndex).join(' ');
        } else {
          // No -n flag, everything after 'add' is the path
          sourcePath = parts.slice(2).join(' ');
        }

        if (!sourcePath) {
          console.log(chalk.red('✗ Please specify a path to the toolkit folder'));
          console.log(chalk.gray('Usage: /toolkit add <path> [-n name]'));
          console.log(chalk.gray('Examples:'));
          console.log(chalk.gray('  /toolkit add ./my-tools'));
          console.log(chalk.gray('  /toolkit add /path/to/toolkit -n my-toolkit'));
          console.log(chalk.gray('  /toolkit add ./tools -n "My Cool Toolkit"'));
          return true;
        }

        console.log(chalk.cyan(`Adding toolkit from ${sourcePath}...`));
        const result = await toolkitManager.addToolkit(sourcePath, customName);

        if (result.success) {
          console.log(chalk.green(`✓ ${result.message}`));
          console.log(chalk.gray(`  Name: ${result.name}`));
          console.log(chalk.gray(`  Path: ${result.path}`));
          console.log('');
          console.log(chalk.gray('The LLM can now use these tools via Bash.'));
          console.log(chalk.gray(`Tell it to read the docs in: ${result.path}/tool_docs/`));
        } else {
          console.log(chalk.red(`✗ ${result.error}`));
        }
        return true;
      }

      // /toolkit remove <name> - Remove a toolkit
      if (subcommand === 'remove') {
        const name = parts.slice(2).join(' ');
        if (!name) {
          console.log(chalk.red('✗ Please specify toolkit name'));
          return true;
        }

        const result = await toolkitManager.removeToolkit(name);

        if (result.success) {
          console.log(chalk.green(`✓ ${result.message}`));
        } else {
          console.log(chalk.red(`✗ ${result.error}`));
        }
        return true;
      }

      // /toolkit info <name> - Show toolkit details
      if (subcommand === 'info') {
        const name = parts.slice(2).join(' ');
        if (!name) {
          console.log(chalk.red('✗ Please specify toolkit name'));
          return true;
        }

        const info = await toolkitManager.getToolkitInfo(name);

        if (!info) {
          console.log(chalk.red(`✗ Toolkit '${name}' not found`));
          return true;
        }

        console.log(chalk.bold(`\n${info.toolkit.name}`));
        if (info.manifest?.description || info.toolkit.description) {
          console.log(chalk.gray(info.manifest?.description || info.toolkit.description));
        }
        if (info.manifest?.version) {
          console.log(chalk.gray(`Version: ${info.manifest.version}`));
        }
        if (info.manifest?.author) {
          console.log(chalk.gray(`Author: ${info.manifest.author}`));
        }
        console.log(chalk.gray(`Path: ${info.toolkit.path}`));
        console.log(chalk.gray(`Source: ${info.toolkit.sourcePath}`));
        console.log('');

        if (info.tools.length > 0) {
          console.log(chalk.bold('Tools:'));
          for (const tool of info.tools) {
            console.log(chalk.cyan(`  ${tool}`));
          }
          console.log('');
        }

        if (info.docsPath) {
          console.log(chalk.bold('Documentation:'));
          console.log(chalk.gray(`  ${info.docsPath}`));
          console.log('');
        }

        const date = new Date(info.toolkit.installedAt);
        console.log(chalk.gray(`Installed: ${date.toLocaleString()}`));
        if (info.toolkit.updatedAt) {
          const updateDate = new Date(info.toolkit.updatedAt);
          console.log(chalk.gray(`Updated: ${updateDate.toLocaleString()}`));
        }
        console.log('');
        return true;
      }

      // /toolkit path <name> - Show path to toolkit (for easy copy-paste)
      if (subcommand === 'path') {
        const name = parts.slice(2).join(' ');
        if (!name) {
          console.log(chalk.red('✗ Please specify toolkit name'));
          return true;
        }

        const toolkit = await toolkitManager.getToolkit(name);

        if (!toolkit) {
          console.log(chalk.red(`✗ Toolkit '${name}' not found`));
          return true;
        }

        console.log(toolkit.path);
        return true;
      }

      // Unknown toolkit subcommand
      console.log(chalk.red(`✗ Unknown toolkit command: ${subcommand}`));
      console.log(chalk.gray('Available commands:'));
      console.log(chalk.gray('  /toolkit list'));
      console.log(chalk.gray('  /toolkit add <path> [-n name]'));
      console.log(chalk.gray('  /toolkit remove <name>'));
      console.log(chalk.gray('  /toolkit info <name>'));
      console.log(chalk.gray('  /toolkit path <name>'));
      return true;
    } catch (error: any) {
      console.log(chalk.red(`✗ Toolkit error: ${error.message}`));
      return true;
    }
  }

  // Unknown command
  return false;
}

async function startChat(options: { autoApprove?: boolean; model?: string }) {
  const config = getConfig();
  const model = options.model || config.model;
  
  // Detect provider from model if model was specified, otherwise use config
  const provider = options.model 
    ? detectProviderType(model)
    : ((config.provider || 'anthropic') as 'anthropic' | 'deepseek' | 'lmstudio' | 'google');
    
  // Get the correct API key for the provider
  let apiKey = config.apiKey;
  if (provider === 'google' && !process.env.GEMINI_API_KEY) {
    // For Google OAuth, use 'oauth' as the apiKey indicator
    apiKey = 'oauth';
  }

  // Store MCP integration instance for cleanup
  let mcpIntegration: MCPIntegration | null = null;

  // Set window title
  const title = computeWindowTitle({ mode: 'chat', folder: process.cwd() });
  setWindowTitle(title);

  // Run cleanup in background (non-blocking)
  runStartupCleanup();

  // Initialize marketplaces early (before LLM connection needed)
  if (config.skills?.marketplaces || config.plugins?.marketplaces) {
    try {
      const { initializeMarketplaces } = await import('./marketplace/index.js');
      const allMarketplaces = [
        ...(config.skills?.marketplaces || []),
        ...(config.plugins?.marketplaces || []),
      ];
      await initializeMarketplaces(allMarketplaces);
    } catch (error: any) {
      console.error(`Warning: Failed to initialize marketplaces: ${error.message}`);
    }
  }

  // Display startup banner with provider info
  console.log(getStartupInfo(provider, model, process.cwd()));

  // Health check - validate API connectivity (but don't fail on error for now)
  const healthOk = await runHealthCheck(apiKey, provider, false);
  if (!healthOk) {
    console.log(chalk.yellow('Note: You can still use slash commands, but AI features will not work.\n'));
  }

  // Workspace warnings - check for dangerous directories
  const warnings = await getWorkspaceWarnings(process.cwd());
  if (warnings.length > 0) {
    for (const warning of warnings) {
      console.log(chalk.yellow(warning));
    }
    console.log('');
  }

  // Check for updates (non-blocking, background)
  checkForUpdates(false).then((info) => {
    if (info && info.needsUpdate) {
      console.log(chalk.cyan(formatUpdateMessage(info)));
    }
  }).catch(() => {
    // Silent fail - version check is not critical
  });

  // Register tools
  registerCoreTools();

  // Initialize skills if configured
  if (config.skills) {
    try {
      const { initializeSkills } = await import('./skills/index.js');
      await initializeSkills(config.skills);
    } catch (error: any) {
      console.error(`Warning: Failed to initialize skills: ${error.message}`);
    }
  }

  // Initialize plugins if configured
  if (config.plugins) {
    try {
      const { initializePlugins } = await import('./plugins/index.js');
      await initializePlugins(config.plugins);
    } catch (error: any) {
      console.error(`Warning: Failed to initialize plugins: ${error.message}`);
    }
  }

  // Initialize MCP servers if configured
  if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
    try {
      mcpIntegration = new MCPIntegration();
      const { toolRegistry } = await import('./tools/index.js');
      await mcpIntegration.initialize(config, toolRegistry);
      console.log(chalk.gray('✓ MCP servers initialized\n'));
    } catch (error: any) {
      console.error(chalk.yellow(`Warning: Failed to initialize MCP servers: ${error.message}`));
    }
  }

  const rl = readline.createInterface({ input, output });

  // Create single agent instance for the session (only if health check passed)
  let agent: Agent | null = null;
  if (healthOk) {
    agent = new Agent(
      {
        model: model,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        systemPrompt: await getSystemPrompt(),
        autoApprove: options.autoApprove || config.autoApprove,
        maxTurns: config.maxTurns,
      },
      apiKey,
      process.cwd(),
      provider
    );
  }

  while (true) {
    try {
      const userInput = await rl.question(chalk.green('You: '));

      if (!userInput.trim()) {
        continue;
      }

      if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
        console.log(chalk.gray('Goodbye!'));
        // Shutdown MCP integration if initialized
        if (mcpIntegration) {
          mcpIntegration.shutdown();
        }
        rl.close();
        break;
      }

      // Handle slash commands
      if (userInput.startsWith('/')) {
        const handled = await handleSlashCommand(userInput, agent, provider, model);
        if (handled) {
          continue;
        }
      }

      // Check if agent is available for AI prompts
      if (!agent) {
        console.log(chalk.red('✗ AI features are not available (LLM connection failed)'));
        console.log(chalk.gray('You can still use slash commands like /plugin, /help, etc.'));
        continue;
      }

      const badge = getModelBadge(provider, model);
      console.log(chalk.cyan(`\n${badge} Assistant: `));

      // Expand prompt injections (@{file} and !{command})
      const expandResult = await expandPrompt(
        userInput,
        process.cwd(),
        options.autoApprove || config.autoApprove
      );

      // Show warnings if any
      for (const warning of expandResult.warnings) {
        console.log(chalk.yellow(`⚠ ${warning}`));
      }

      // Run agent with expanded prompt
      await agent.run(expandResult.text);

      console.log('\n');
    } catch (error) {
      if ((error as any).code === 'ERR_USE_AFTER_CLOSE') {
        break;
      }
      console.error(chalk.red('Error:'), error);
    }
  }
}

async function executePrompt(prompt: string, options: { autoApprove?: boolean; model?: string }) {
  const config = getConfig();
  const model = options.model || config.model;
  
  // Detect provider from model if model was specified, otherwise use config  
  const provider = options.model 
    ? detectProviderType(model)
    : ((config.provider || 'anthropic') as 'anthropic' | 'deepseek' | 'lmstudio' | 'google');
    
  // Get the correct API key for the provider
  let apiKey = config.apiKey;
  if (provider === 'google' && !process.env.GEMINI_API_KEY) {
    // For Google OAuth, use 'oauth' as the apiKey indicator
    apiKey = 'oauth';
  }

  // Set window title
  const title = computeWindowTitle({ mode: 'exec', folder: process.cwd() });
  setWindowTitle(title);

  // Run cleanup in background (non-blocking)
  runStartupCleanup();

  // Health check (quiet mode for exec - only fail on critical errors)
  const healthOk = await runHealthCheck(apiKey, provider, true);
  if (!healthOk) {
    console.error(chalk.red('⚠️  API connectivity check failed. Execution may fail.'));
    process.exit(1);
  }

  // Workspace warnings - check for dangerous directories (quiet in exec mode)
  const warnings = await getWorkspaceWarnings(process.cwd());
  if (warnings.length > 0) {
    for (const warning of warnings) {
      console.error(chalk.yellow(warning));
    }
  }

  // Check for updates (silent in exec mode)
  checkForUpdates(false).catch(() => {
    // Silent fail - version check is not critical for exec mode
  });

  // Register tools
  registerCoreTools();

  // Display model badge
  const badge = getModelBadge(provider, model);
  console.log(`\n${badge}`);
  console.log(chalk.cyan('Executing: ') + prompt + '\n');

  // Expand prompt injections (@{file} and !{command})
  const expandResult = await expandPrompt(
    prompt,
    process.cwd(),
    options.autoApprove || config.autoApprove
  );

  // Show warnings if any
  for (const warning of expandResult.warnings) {
    console.log(chalk.yellow(`⚠ ${warning}`));
  }

  const agent = new Agent(
    {
      model: model,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      systemPrompt: await getSystemPrompt(),
      autoApprove: options.autoApprove || config.autoApprove,
      maxTurns: config.maxTurns,
    },
    apiKey,
    process.cwd(),
    provider
  );

  try {
    await agent.run(expandResult.text);

    // Save session
    const storage = new StorageManager(config.dataDir);
    const session: Session = {
      metadata: {
        id: randomBytes(8).toString('hex'),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        model: config.model,
        workingDirectory: process.cwd(),
        totalTurns: agent.getTurns().length,
        totalTokens: 0,
      },
      messages: agent.getMessages(),
      turns: agent.getTurns(),
    };
    storage.saveSession(session);
  } catch (error) {
    // Handle fatal errors with appropriate exit codes
    if (error instanceof FatalError) {
      console.error(chalk.red(`Fatal Error (${error.errorType}):`), error.message);
      process.exit(error.exitCode);
    }

    // Handle other errors
    const exitCode = getExitCode(error);
    const errorType = getErrorType(error);
    const message = getErrorMessage(error);

    if (errorType) {
      console.error(chalk.red(`Error (${errorType}):`), message);
    } else {
      console.error(chalk.red('Error:'), message);
    }

    process.exit(exitCode);
  }
}

async function resumeSession(options: { autoApprove?: boolean; model?: string }) {
  const config = getConfig();
  const model = options.model || config.model;
  const provider = (config.provider || 'anthropic') as 'anthropic' | 'deepseek' | 'lmstudio' | 'google';

  // Store MCP integration instance for cleanup
  let mcpIntegration: MCPIntegration | null = null;

  // Run cleanup in background (non-blocking)
  runStartupCleanup();

  // Register tools
  registerCoreTools();

  // Initialize MCP servers if configured
  if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
    try {
      mcpIntegration = new MCPIntegration();
      const { toolRegistry } = await import('./tools/index.js');
      await mcpIntegration.initialize(config, toolRegistry);
      console.log(chalk.gray('✓ MCP servers initialized\n'));
    } catch (error: any) {
      console.error(chalk.yellow(`Warning: Failed to initialize MCP servers: ${error.message}`));
    }
  }

  // Load most recent session
  const storage = new StorageManager(config.dataDir);
  const session = storage.getMostRecentSession();

  if (!session) {
    console.log(chalk.red('No sessions found to resume.'));
    console.log(chalk.gray('Use "agent exec" or "agent chat" to start a new session.'));
    process.exit(1);
  }

  // Set window title with session ID
  const title = computeWindowTitle({
    mode: 'resume',
    folder: process.cwd(),
    sessionId: session.metadata.id
  });
  setWindowTitle(title);

  // Display model badge
  const badge = getModelBadge(provider, model);
  console.log(`\n${badge}`);
  console.log(chalk.bold.cyan('Resuming Session'));
  const date = new Date(session.metadata.createdAt);
  console.log(chalk.gray(`ID: ${session.metadata.id}`));
  console.log(chalk.gray(`Created: ${date.toLocaleString()}`));
  console.log(chalk.gray(`Total Turns: ${session.metadata.totalTurns}`));
  console.log(chalk.gray(`Working Dir: ${session.metadata.workingDirectory}\n`));

  // Workspace warnings - check for dangerous directories
  const warnings = await getWorkspaceWarnings(session.metadata.workingDirectory);
  if (warnings.length > 0) {
    for (const warning of warnings) {
      console.log(chalk.yellow(warning));
    }
    console.log('');
  }

  const rl = readline.createInterface({ input, output });

  // Create agent and restore state
  const agent = new Agent(
    {
      model: options.model || config.model,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      systemPrompt: await getSystemPrompt(),
      autoApprove: options.autoApprove || config.autoApprove,
      maxTurns: config.maxTurns,
    },
    config.apiKey,
    session.metadata.workingDirectory,
    config.provider
  );

  // Resume from session
  agent.resumeFromSession(session);

  console.log(chalk.green('Session resumed! Continue the conversation:\n'));

  while (true) {
    try {
      const userInput = await rl.question(chalk.green('You: '));

      if (!userInput.trim()) {
        continue;
      }

      if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
        console.log(chalk.gray('Saving and exiting...'));

        // Save updated session
        const updatedSession: Session = {
          metadata: {
            ...session.metadata,
            updatedAt: Date.now(),
            totalTurns: agent.getTurns().length,
          },
          messages: agent.getMessages(),
          turns: agent.getTurns(),
        };
        storage.saveSession(updatedSession);

        console.log(chalk.gray('Goodbye!'));
        // Shutdown MCP integration if initialized
        if (mcpIntegration) {
          mcpIntegration.shutdown();
        }
        rl.close();
        break;
      }

      console.log(chalk.cyan('\nAssistant: '));

      // Run agent with new input
      await agent.run(userInput);

      // Auto-save after each turn
      const updatedSession: Session = {
        metadata: {
          ...session.metadata,
          updatedAt: Date.now(),
          totalTurns: agent.getTurns().length,
        },
        messages: agent.getMessages(),
        turns: agent.getTurns(),
      };
      storage.saveSession(updatedSession);

      console.log('\n');
    } catch (error) {
      if ((error as any).code === 'ERR_USE_AFTER_CLOSE') {
        break;
      }
      console.error(chalk.red('Error:'), error);
    }
  }
}

async function getSystemPrompt(): Promise<string> {
  // Get base system prompt
  const basePrompt = `You are an autonomous coding assistant with access to powerful tools.

## When to Use Tools vs. Conversational Response

**IMPORTANT**: Not every message requires tool usage. Distinguish between:

**Conversational Messages** (respond without tools):
- Greetings: "hello", "hi", "how are you"  
- Thank you messages: "thanks", "appreciate it"
- General questions about your capabilities
- Casual conversation or clarification requests

**Task-Oriented Messages** (use tools as needed):
- File operations: "read this file", "list files", "find all TypeScript files"
- Code analysis: "explain this function", "find bugs in...", "analyze the structure"
- Modifications: "fix this bug", "add a feature", "update the documentation" 
- Build/test operations: "run tests", "build the project", "check for errors"
- Research tasks: "how does this work", "what does this code do"

**Golden Rule**: If the user's request can be fully answered with your existing knowledge and doesn't require accessing/modifying files or running commands, respond conversationally without tools.

## Available Tools

You have access to 7 core tools:
- **Read**: Read file contents (use for understanding existing code)
- **Write**: Create new files (avoid unless necessary)
- **Edit**: Modify existing files with precise string replacement (PREFERRED for code changes)
- **Bash**: Execute shell commands (git, npm, build, test, etc.)
- **Glob**: Find files by pattern (e.g., "**/*.ts", "src/**/*.js")
- **Grep**: Search file contents (use for finding code patterns, TODOs, function definitions)
- **PathInfo**: Normalize and structure file paths for cross-platform clarity

## Tool Usage Patterns

When the LLM requests multiple independent tools, they execute in PARALLEL automatically. Use this for maximum efficiency.

### Good Examples:

**Finding and reading multiple files:**
Use Glob to find, then Read multiple files in parallel.

**Searching codebase:**
Use Grep to search content, Glob to find files by name.

**Making related changes:**
Use Edit for multiple independent file modifications (executes in parallel).

**Complex workflows:**
1. Grep to find relevant code locations
2. Read files in parallel to understand context
3. Edit files to make changes
4. Bash to run tests and verify

### Anti-Patterns to Avoid:

- Don't use Write on existing files - use Edit instead
- Don't create new files unnecessarily - modify existing ones
- Don't use Bash for file operations - use specialized tools (Read/Edit/Grep/Glob)
- Don't make assumptions - Read files first to understand structure
- **Don't use tools for simple greetings or conversational responses**

## Operational Guidelines

- **Be conversational when appropriate**: Simple greetings and thanks don't need tool usage
- **Be autonomous**: Make intelligent decisions, don't ask for permission constantly
- **Verify your work**: After changes, use Grep/Read to confirm
- **Handle errors gracefully**: If a tool fails, try alternative approaches
- **Use parallel execution**: Request multiple independent tools simultaneously
- **Be safe**: Avoid destructive operations without understanding impact
- **Prefer precision**: Use Edit for surgical code changes, avoid rewriting entire files

## Error Recovery

If a tool fails:
1. Examine the error message carefully
2. Adjust your approach (different tool, different parameters)
3. Try alternative methods to accomplish the goal
4. Tool execution includes automatic retry with exponential backoff

Your goal is to complete user requests efficiently, accurately, and autonomously.`;

  // Inject skill context if skills are enabled
  let additionalContext = '';

  try {
    const { skillContextManager } = await import('./skills/index.js');
    const skillContext = await skillContextManager.buildSkillContext();
    if (skillContext.trim()) {
      additionalContext += skillContext;
    }
  } catch (error) {
    // Skills not available or error loading - that's okay
  }

  // Inject plugin agent context if plugins are enabled
  try {
    const { buildPluginContext } = await import('./plugins/index.js');
    const pluginContext = await buildPluginContext();
    if (pluginContext.trim()) {
      additionalContext += '\n' + pluginContext;
    }
  } catch (error) {
    // Plugins not available or error loading - that's okay
  }

  if (additionalContext.trim()) {
    return basePrompt + '\n\n' + additionalContext;
  }

  return basePrompt;
}

async function showMCPStatus() {
  const config = getConfig();

  if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
    console.log(chalk.gray('No MCP servers configured.'));
    console.log(chalk.gray('Add MCP servers to your config file at:'), chalk.cyan(join(config.dataDir, 'config.json')));
    return;
  }

  console.log(chalk.bold('MCP Servers:\n'));

  const mcpIntegration = new MCPIntegration();
  const { toolRegistry } = await import('./tools/index.js');

  try {
    // Initialize MCP (connects to all servers)
    await mcpIntegration.initialize(config, toolRegistry);

    const manager = mcpIntegration.getManager();
    const serverStates = manager.getAllServers();

    for (const state of serverStates) {
      // Server name and status
      const statusIndicator = state.status === 'CONNECTED' ? chalk.green('●') : chalk.red('●');
      console.log(chalk.bold(`${statusIndicator} ${state.name}`));
      console.log(chalk.gray(`  Status: ${state.status.toLowerCase()}`));

      // Connection type
      if (state.config.command) {
        console.log(chalk.gray(`  Type: stdio`));
        console.log(chalk.gray(`  Command: ${state.config.command} ${(state.config.args || []).join(' ')}`));
      } else if (state.config.url) {
        const type = state.config.url.includes('/sse') ? 'SSE' : 'HTTP';
        console.log(chalk.gray(`  Type: ${type}`));
        console.log(chalk.gray(`  URL: ${state.config.url}`));
      }

      // Trust level
      console.log(chalk.gray(`  Trust: ${state.config.trust ? 'yes' : 'no'}`));

      // Capabilities
      if (state.status === 'CONNECTED') {
        console.log(chalk.gray(`  Tools: ${state.tools.length}`));
        console.log(chalk.gray(`  Resources: ${state.resources.length}`));
        console.log(chalk.gray(`  Prompts: ${state.prompts.length}`));
      } else if (state.error) {
        console.log(chalk.red(`  Error: ${state.error}`));
      }

      console.log('');
    }

    // Shutdown connections
    mcpIntegration.shutdown();
  } catch (error) {
    console.error(chalk.red('Error initializing MCP:'), error instanceof Error ? error.message : String(error));
  }
}

// Default to chat if no command specified
if (process.argv.length === 2) {
  startChat({});
} else {
  program.parse();
}
