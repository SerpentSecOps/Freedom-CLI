/**
 * Provider banners and startup information
 */

import chalk from 'chalk';
import { getRandomTip } from './tips.js';

export function getDeepSeekLogo(): string {
  // DeepSeek logo with gradient from light cyan to dark blue
  const line1 = chalk.hex('#00FFFF')('  ██████╗ ███████╗███████╗██████╗ ███████╗███████╗███████╗██╗  ██╗');
  const line2 = chalk.hex('#00D4FF')('  ██╔══██╗██╔════╝██╔════╝██╔══██╗██╔════╝██╔════╝██╔════╝██║ ██╔╝');
  const line3 = chalk.hex('#00AAFF')('  ██║  ██║█████╗  █████╗  ██████╔╝███████╗█████╗  █████╗  █████╔╝');
  const line4 = chalk.hex('#0080FF')('  ██║  ██║██╔══╝  ██╔══╝  ██╔═══╝ ╚════██║██╔══╝  ██╔══╝  ██╔═██╗');
  const line5 = chalk.hex('#0055FF')('  ██████╔╝███████╗███████╗██║     ███████║███████╗███████╗██║  ██╗');
  const line6 = chalk.hex('#0033DD')('  ╚═════╝ ╚══════╝╚══════╝╚═╝     ╚══════╝╚══════╝╚══════╝╚═╝  ╚═╝');

  return '\n' + line1 + '\n' + line2 + '\n' + line3 + '\n' + line4 + '\n' + line5 + '\n' + line6 + '\n';
}

export function getClaudeLogo(): string {
  // Simple Claude logo
  return chalk.magenta(`
    ╔═══════════════════════════════╗
    ║                               ║
    ║     ╔═╗┬  ┌─┐┬ ┬┌┬┐┌─┐       ║
    ║     ║  │  ├─┤│ │ ││├┤        ║
    ║     ╚═╝┴─┘┴ ┴└─┘─┴┘└─┘       ║
    ║                               ║
    ║   Anthropic Claude AI         ║
    ║                               ║
    ╚═══════════════════════════════╝
  `);
}

export function getLMStudioLogo(): string {
  // LM Studio logo in purple
  return chalk.hex('#9945FF')(`
  __/\\\\\\______________/\\\\\\\\____________/\\\\\\________________________/\\\\\\\\\\\\\\\\______________________________________/\\\\\\______________________
   _\\/\\\\____________\\/\\\\\\\\________/\\\\\\\\______________________/\\\\/////////\\\\\\___________________________________\\/\\\\\\______________________
    _\\/\\\\____________\\/\\\\//\\\\____/\\\\//\\\\______________________\\//\\\\______\\///______/\\\\__________________________\\/\\\\\\__/\\\\\\_______________
     _\\/\\\\____________\\/\\\\\\///\\\\/\\\\/_\\/\\\\_______________________\\////\\\\__________/\\\\\\\\\\\\\\__/\\\\\\____/\\\\\\________\\/\\\\__\\///______/\\\\\\\\____
      _\\/\\\\____________\\/\\\\__\\///\\\\/___\\/\\\\__________________________\\////\\\\______\\////\\\\////__\\/\\\\\\___\\/\\\\\\___/\\\\\\\\\\\\\\\___/\\\\\\___/\\\\///\\\\__
       _\\/\\\\____________\\/\\\\____\\///_____\\/\\\\_____________________________\\////\\\\______\\/\\\\______\\/\\\\\\___\\/\\\\__/\\\\///\\\\\\__\\/\\\\__/\\\\__\\//\\\\_
        _\\/\\\\____________\\/\\\\_____________\\/\\\\______________________/\\\\______\\//\\\\_____\\/\\\\_/\\\\__\\/\\\\\\___\\/\\\\_\\/\\\\__\\/\\\\__\\/\\\\_\\//\\\\__/\\\\__
         _\\/\\\\\\\\\\\\\\\\\\\\\\\\\\_\\/\\\\_____________\\/\\\\_____________________\\///\\\\\\\\\\\\\\\\/______\\//\\\\\\\\___\\//\\\\\\\\\\\\\__\\//\\\\\\\\\\/\\_\\/\\\\__\\///\\\\\\\\___
          _\\///////////////__\\///______________\\///________________________\\///////////_________\\/////_____\\/////////____\\///////\\//__\\///_____\\////_____
  `);
}

export function getProviderBanner(provider: 'anthropic' | 'deepseek' | 'lmstudio' | 'google', model: string): string {
  let banner = '';

  if (provider === 'lmstudio') {
    banner += getLMStudioLogo();
    banner += '\n';
    banner += chalk.hex('#9945FF')('  ╔═══════════════════════════════════════════════════════╗\n');
    banner += chalk.hex('#9945FF')('  ║                                                       ║\n');
    banner += chalk.hex('#9945FF')('  ║  ') + chalk.white.bold('LM Studio') + chalk.hex('#9945FF')(' - Local AI Models                    ║\n');
    banner += chalk.hex('#9945FF')('  ║  ') + chalk.gray('Model: ' + (model || 'local')) + ' '.repeat(Math.max(0, 38 - (model || 'local').length)) + chalk.hex('#9945FF')('║\n');
    banner += chalk.hex('#9945FF')('  ║                                                       ║\n');
    banner += chalk.hex('#9945FF')('  ╚═══════════════════════════════════════════════════════╝\n');
  } else if (provider === 'deepseek') {
    banner += getDeepSeekLogo();
    banner += '\n';
    banner += chalk.bold.cyan('  ╔═══════════════════════════════════════════════════════╗\n');
    banner += chalk.bold.cyan('  ║                                                       ║\n');

    if (model === 'deepseek-reasoner') {
      banner += chalk.bold.cyan('  ║  ') + chalk.white.bold('DeepSeek Reasoner') + chalk.cyan(' - Advanced Reasoning Model  ║\n');
      banner += chalk.bold.cyan('  ║  ') + chalk.gray('Chain-of-thought reasoning enabled') + chalk.cyan('            ║\n');
    } else {
      banner += chalk.bold.cyan('  ║  ') + chalk.white.bold('DeepSeek Chat') + chalk.cyan(' - Fast General Purpose Model  ║\n');
      banner += chalk.bold.cyan('  ║  ') + chalk.gray('Optimized for coding and tasks') + chalk.cyan('               ║\n');
    }

    banner += chalk.bold.cyan('  ║                                                       ║\n');
    banner += chalk.bold.cyan('  ╚═══════════════════════════════════════════════════════╝\n');
  } else if (provider === 'anthropic') {
    banner += getClaudeLogo();
    banner += '\n';
    banner += chalk.bold.magenta('  ╔═══════════════════════════════════════════════════════╗\n');
    banner += chalk.bold.magenta('  ║                                                       ║\n');

    if (model.includes('opus')) {
      banner += chalk.bold.magenta('  ║  ') + chalk.white.bold('Claude Opus') + chalk.magenta(' - Most Capable Model            ║\n');
    } else if (model.includes('sonnet')) {
      banner += chalk.bold.magenta('  ║  ') + chalk.white.bold('Claude Sonnet') + chalk.magenta(' - Balanced Performance          ║\n');
    } else if (model.includes('haiku')) {
      banner += chalk.bold.magenta('  ║  ') + chalk.white.bold('Claude Haiku') + chalk.magenta(' - Fast and Efficient            ║\n');
    } else {
      banner += chalk.bold.magenta('  ║  ') + chalk.white.bold('Claude') + chalk.magenta('                                      ║\n');
    }

    banner += chalk.bold.magenta('  ║  ') + chalk.gray('Model: ' + model) + ' '.repeat(Math.max(0, 38 - model.length)) + chalk.magenta('║\n');
    banner += chalk.bold.magenta('  ║                                                       ║\n');
    banner += chalk.bold.magenta('  ╚═══════════════════════════════════════════════════════╝\n');
  }

  return banner;
}

export function getStartupInfo(provider: 'anthropic' | 'deepseek' | 'lmstudio' | 'google', model: string, workingDir: string): string {
  const banner = getProviderBanner(provider, model);

  let info = banner;
  info += '\n';
  info += chalk.gray('  Working Directory: ') + chalk.white(workingDir) + '\n';
  info += chalk.gray('  Type your message or "exit" to quit') + '\n';
  info += '\n';
  info += chalk.cyan('  💡 Tip: ') + chalk.white(getRandomTip()) + '\n';
  info += '\n';

  return info;
}

export function getReasoningIndicator(): string {
  return chalk.yellow('💭 Reasoning');
}

export function getModelBadge(provider: 'anthropic' | 'deepseek' | 'lmstudio' | 'google', model: string): string {
  if (provider === 'lmstudio') {
    return chalk.hex('#9945FF')('[LM Studio]');
  }

  if (provider === 'google') {
    if (model === 'gemini-1.5-pro') {
      return chalk.hex('#4285f4')('[Gemini 1.5 Pro]');
    } else if (model === 'gemini-1.5-flash') {
      return chalk.hex('#4285f4')('[Gemini 1.5 Flash]');
    } else if (model === 'gemini-1.0-pro') {
      return chalk.hex('#4285f4')('[Gemini 1.0 Pro]');
    }
    return chalk.hex('#4285f4')('[Google AI]');
  }

  if (provider === 'deepseek') {
    if (model === 'deepseek-reasoner') {
      return chalk.cyan('[DeepSeek Reasoner]');
    }
    return chalk.cyan('[DeepSeek Chat]');
  }

  if (model.includes('opus')) {
    return chalk.magenta('[Claude Opus]');
  } else if (model.includes('sonnet')) {
    return chalk.magenta('[Claude Sonnet]');
  } else if (model.includes('haiku')) {
    return chalk.magenta('[Claude Haiku]');
  }

  return chalk.magenta('[Claude]');
}
