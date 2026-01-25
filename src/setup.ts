/**
 * Interactive setup and model selection
 * Integrated with Secure Secret Manager (Keychain/.env).
 */

import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { updateConfig } from './config.js';

export interface ModelConfig {
  provider: 'anthropic' | 'deepseek' | 'lmstudio' | 'google';
  model: string;
  apiKey?: string;
  baseURL?: string;
}

// Provider and model definitions for interactive menu
interface ProviderOption {
  id: 'anthropic' | 'deepseek' | 'lmstudio' | 'google';
  name: string;
  color: (s: string) => string;
  description: string;
  models: ModelOption[];
}

interface ModelOption {
  id: string;
  name: string;
  description: string;
}

const PROVIDERS: ProviderOption[] = [
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    color: chalk.magenta,
    description: 'Highest quality (Opus, Sonnet, Haiku)',
    models: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Recommended - Best balance' },
      { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', description: 'Most capable' },
      { id: 'claude-haiku-4-20250514', name: 'Claude Haiku 4', description: 'Fastest' },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    color: chalk.cyan,
    description: 'Cost-effective with reasoning',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat', description: 'Fast & capable' },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', description: 'Advanced reasoning with CoT' },
    ],
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    color: chalk.hex('#9945FF'),
    description: 'Local, private, free',
    models: [
      { id: 'local', name: 'Local Model', description: 'Use currently loaded model' },
    ],
  },
  {
    id: 'google',
    name: 'Google AI',
    color: chalk.hex('#4285f4'),
    description: 'AI Pro subscription (OAuth)',
    models: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Most capable, stable' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Fastest responses' },
      { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', description: 'Ultra-fast, lightweight' },
      { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview', description: 'Latest preview' },
      { id: 'auto-gemini-2.5', name: 'Auto Gemini 2.5', description: 'Auto-routing' },
    ],
  },
];

/**
 * Interactive arrow-key menu for selecting from a list
 */
async function interactiveSelect<T extends { name: string; description?: string }>
(
  title: string,
  options: T[],
  renderOption: (option: T, isSelected: boolean, index: number) => string
): Promise<T | null> {
  return new Promise((resolve) => {
    let selectedIndex = 0;
    const stdin = process.stdin;
    const stdout = process.stdout;

    stdout.write('\x1B[?25l');

    const render = () => {
      stdout.write('\x1B[2J\x1B[H');
      console.log(chalk.bold.yellow(`\n🔄 ${title}\n`));
      console.log(chalk.gray('  Use ↑/↓ arrows to navigate, Enter to select, Esc to cancel\n'));
      for (let i = 0; i < options.length; i++) {
        console.log(renderOption(options[i], i === selectedIndex, i));
      }
      console.log('');
    };

    render();

    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }
    stdin.resume();

    const onKeypress = (data: Buffer) => {
      const key = data.toString();
      if (key === '\x1B' || key === '\x1B\x1B') {
        cleanup();
        resolve(null);
        return;
      }
      if (key === '\r' || key === '\n') {
        cleanup();
        resolve(options[selectedIndex]);
        return;
      }
      if (key === '\x1B[A' || key === 'k') {
        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
        render();
      } else if (key === '\x1B[B' || key === 'j') {
        selectedIndex = (selectedIndex + 1) % options.length;
        render();
      }
      const num = parseInt(key);
      if (num >= 1 && num <= options.length) {
        selectedIndex = num - 1;
        cleanup();
        resolve(options[selectedIndex]);
      }
    };

    const cleanup = () => {
      stdin.removeListener('data', onKeypress);
      if (stdin.isTTY) {
        stdin.setRawMode(wasRaw ?? false);
      }
      stdout.write('\x1B[?25h');
    };

    stdin.on('data', onKeypress);
  });
}

export async function promptForModel(rl: readline.Interface, existingConfig?: ModelConfig): Promise<ModelConfig> {
  return await handleModelCommand(rl);
}

export function saveLastModel(config: ModelConfig): void {
  const dataDir = join(homedir(), '.freedom-cli');
  const lastModelPath = join(dataDir, 'last-model.json');
  if (!existsSync(dataDir)) {
    const { mkdirSync } = require('fs');
    mkdirSync(dataDir, { recursive: true });
  }
  writeFileSync(lastModelPath, JSON.stringify(config, null, 2));
}

export function loadLastModel(): ModelConfig | null {
  const dataDir = join(homedir(), '.freedom-cli');
  const lastModelPath = join(dataDir, 'last-model.json');
  if (!existsSync(lastModelPath)) return null;
  try {
    const content = readFileSync(lastModelPath, 'utf-8');
    return JSON.parse(content);
  } catch (e) {
    return null;
  }
}

export async function handleModelCommand(rl: readline.Interface): Promise<ModelConfig> {
  const lastModel = loadLastModel();

  const selectedProvider = await interactiveSelect(
    'Select Provider',
    PROVIDERS,
    (provider, isSelected, index) => {
      const prefix = isSelected ? chalk.green('❯ ') : '  ';
      const num = chalk.gray(`${index + 1}.`);
      const name = isSelected ? provider.color(chalk.bold(provider.name)) : provider.color(provider.name);
      const desc = chalk.gray(` - ${provider.description}`);
      const current = lastModel?.provider === provider.id ? chalk.yellow(' (current)') : '';
      return `${prefix}${num} ${name}${desc}${current}`;
    }
  );

  if (!selectedProvider) {
    if (lastModel) {
      console.log(chalk.yellow('\nCancelled - keeping current model\n'));
      return lastModel;
    }
    throw new Error('Model selection cancelled');
  }

  const selectedModel = await interactiveSelect(
    `Select ${selectedProvider.name} Model`,
    selectedProvider.models,
    (model, isSelected, index) => {
      const prefix = isSelected ? chalk.green('❯ ') : '  ';
      const num = chalk.gray(`${index + 1}.`);
      const name = isSelected ? chalk.bold.white(model.name) : chalk.white(model.name);
      const desc = chalk.gray(` - ${model.description}`);
      const current = lastModel?.model === model.id ? chalk.yellow(' (current)') : '';
      return `${prefix}${num} ${name}${desc}${current}`;
    }
  );

  if (!selectedModel) {
    if (lastModel) {
      console.log(chalk.yellow('\nCancelled - keeping current model\n'));
      return lastModel;
    }
    throw new Error('Model selection cancelled');
  }

  process.stdout.write('\x1B[2J\x1B[H');

  let config: ModelConfig;

  switch (selectedProvider.id) {
    case 'anthropic': {
      let apiKey = process.env.ANTHROPIC_API_KEY;
      if (apiKey) {
        console.log(chalk.bold.magenta('\n🤖 Anthropic Claude Setup\n'));
        console.log(chalk.gray('Using existing API key (press Enter to keep, or enter new key)'));
        
        const { password } = await import('@inquirer/prompts');
        const newKey = await password({ 
          message: 'Anthropic API key:',
          mask: '*'
        });
        if (newKey.trim()) apiKey = newKey.trim();
      } else {
        console.log(chalk.bold.magenta('\n🤖 Anthropic Claude Setup\n'));
        const { password } = await import('@inquirer/prompts');
        apiKey = await password({ 
          message: 'Enter your Anthropic API key:',
          mask: '*'
        });
      }
      if (!apiKey) throw new Error('API key is required for Anthropic');
      config = { provider: 'anthropic', model: selectedModel.id, apiKey };
      break;
    }

    case 'deepseek': {
      let apiKey = process.env.DEEPSEEK_API_KEY;
      if (apiKey) {
        console.log(chalk.bold.cyan('\n🤖 DeepSeek Setup\n'));
        console.log(chalk.gray('Using existing API key (press Enter to keep, or enter new key)'));
        
        const { password } = await import('@inquirer/prompts');
        const newKey = await password({ 
          message: 'DeepSeek API key:',
          mask: '*'
        });
        if (newKey.trim()) apiKey = newKey.trim();
      } else {
        console.log(chalk.bold.cyan('\n🤖 DeepSeek Setup\n'));
        const { password } = await import('@inquirer/prompts');
        apiKey = await password({ 
          message: 'Enter your DeepSeek API key:',
          mask: '*'
        });
      }
      if (!apiKey) throw new Error('API key is required for DeepSeek');
      config = { provider: 'deepseek', model: selectedModel.id, apiKey };
      break;
    }

    case 'lmstudio': {
      console.log(chalk.bold.hex('#9945FF')('\n🤖 LM Studio Setup\n'));
      console.log(chalk.gray('Make sure LM Studio is running with a model loaded.'));
      const tempRl = readline.createInterface({ input, output });
      const baseURL = await tempRl.question(chalk.green('Server URL (press Enter for default): '));
      const modelName = await tempRl.question(chalk.green('Model name (press Enter for "local"): '));
      tempRl.close();
      config = {
        provider: 'lmstudio',
        model: modelName.trim() || 'local',
        baseURL: baseURL.trim() || 'http://127.0.0.1:1234/v1',
        apiKey: 'not-needed',
      };
      break;
    }

    case 'google': {
      config = { provider: 'google', model: selectedModel.id, apiKey: 'oauth' };
      break;
    }

    default:
      throw new Error(`Unknown provider: ${selectedProvider.id}`);
  }

  // Persist the choice and the key (via secure storage in updateConfig)
  await updateConfig(config);
  saveLastModel(config);
  
  console.log(chalk.green(`\n✓ Model configured: ${selectedProvider.name} - ${selectedModel.name}\n`));
  return config;
}