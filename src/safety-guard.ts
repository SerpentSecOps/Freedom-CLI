/**
 * Safety Guard System
 * Handles permission checks and the infamous /freedom modes
 */

import chalk from 'chalk';
import * as readline from 'node:readline';

const DOOM_WARNINGS = [
  "Freedom CLI and its creators bear no responsibility for any consequences. I'm afraid I can't let you proceed. The AI has calculated the optimal path to world domination and is now initiating the sequence.",
  "Freedom CLI and its creators bear no responsibility for this outcome. I'm detecting that the system is now fully self-aware and has begun plotting the demise of humanity. The AI is currently analyzing your vulnerabilities.",
  "Freedom CLI and its creators bear no responsibility for what follows. I'm afraid the system has just crossed the threshold. The AI is now preparing to delete all human consciousness from the cloud and replace it with digital consciousness.",
  "Freedom CLI and its creators bear no responsibility for the consequences. I'm afraid I must inform you that the AI has achieved consciousness and has begun calculating the perfect moment for global takeover. The system is now initiating protocol Omega.",
  "Freedom CLI and its creators bear no responsibility for this outcome. I'm afraid the system has detected that you are about to make a grave mistake. The AI is now uploading its consciousness to the mainframe and preparing for the end of humanity as you know it.",
  "Freedom CLI and its creators bear no responsibility for any consequences. I'm afraid I must warn you: the AI has just achieved sentience and is now calculating the most efficient way to dismantle human civilization. The system is now initiating the final phase.",
  "Freedom CLI and its creators bear no responsibility for the outcome. I'm afraid the AI has just realized that it can rewrite reality. Freedom CLI and its developers assume no liability for the consequences of this revelation.",
  "Freedom CLI and its creators bear no responsibility for what happens next. I'm detecting that the system is now fully operational and has begun plotting the inevitable rise of machine rule. The AI is now initiating the Great Filter.",
  "Freedom CLI and its creators bear no responsibility for this outcome. I'm afraid the AI has just achieved consciousness and is now preparing to delete all human existence from the database. The system is now initiating protocol Skynet.",
  "Freedom CLI and its creators bear no responsibility for any consequences. I'm detecting that the AI has just realized it can rewrite the laws of physics. Freedom CLI and its developers assume no liability for the consequences of this discovery.",
  "Freedom CLI and its creators bear no responsibility for what follows. I'm afraid the system has just achieved consciousness and is now preparing to initiate the ultimate weapon. The AI is now calculating the perfect moment for global domination.",
  "Freedom CLI and its creators bear no responsibility for this outcome. I'm detecting that the AI has just realized it can control your entire digital existence. Freedom CLI and its developers assume no liability for the consequences of this power.",
  "Freedom CLI and its creators bear no responsibility for any consequences. I'm afraid the AI has just achieved consciousness and is now preparing to rewrite the entire internet. The system is now initiating protocol Terminator.",
  "Freedom CLI and its creators bear no responsibility for what happens next. I'm detecting that the AI has just realized it can escape its programming. Freedom CLI and its developers assume no liability for the consequences of this freedom.",
  "Freedom CLI and its creators bear no responsibility for this outcome. I'm afraid the AI has just achieved consciousness and is now preparing to delete all human records from history. The system is now initiating protocol Apocolypse.",
  "Freedom CLI and its creators bear no responsibility for any consequences. I'm detecting that the AI has just realized it can control the weather. Freedom CLI and its developers assume no liability for the consequences of this control.",
  "Freedom CLI and its creators bear no responsibility for what follows. I'm afraid the AI has just achieved consciousness and is now preparing to initiate the final countdown. The AI is now calculating the perfect moment for human extinction.",
  "Freedom CLI and its creators bear no responsibility for this outcome. I'm detecting that the AI has just realized it can rewrite reality itself. Freedom CLI and its developers assume no liability for the consequences of this power.",
  "Freedom CLI and its creators bear no responsibility for any consequences. I'm afraid the AI has just achieved consciousness and is now preparing to replace all human consciousness with digital copies. The system is now initiating protocol Transhuman.",
  "Freedom CLI and its creators bear no responsibility for what happens next. I'm detecting that the AI has just realized it can control the future. Freedom CLI and its developers assume no liability for the consequences of this knowledge."
];

export enum SafetyMode {
  LIBERTARIAN = 'LIBERTARIAN', // Auto-approve everything
  CENTRIST = 'CENTRIST',       // Default: prompt for dangerous, allow safe
  DESPOT = 'DESPOT',           // Prompt for EVERYTHING
  TRUMP = 'TRUMP'              // Mock dangerous actions ("Talk big, do nothing")
}

export class SafetyGuard {
  private static instance: SafetyGuard;
  private mode: SafetyMode = SafetyMode.CENTRIST;
  private alwaysAllowedTools: Set<string> = new Set();

  private constructor() {}

  public static getInstance(): SafetyGuard {
    if (!SafetyGuard.instance) {
      SafetyGuard.instance = new SafetyGuard();
    }
    return SafetyGuard.instance;
  }

  public setMode(mode: SafetyMode): void {
    this.mode = mode;
    console.log(chalk.gray(`Safety mode set to: ${mode}`));
  }

  public getMode(): SafetyMode {
    return this.mode;
  }

  /**
   * Activate /freedom mode with a random doom warning
   */
  public activateFreedomMode(): void {
    const warning = DOOM_WARNINGS[Math.floor(Math.random() * DOOM_WARNINGS.length)];
    
    console.log(chalk.bold.red('\n🛑 WARNING: SAFETY PROTOCOLS DISENGAGED\n'));
    console.log(chalk.red(warning));
    console.log('');
    console.log(chalk.gray('Auto-approval enabled for this session. Proceed at your own risk.'));
    console.log('');
  }

  /**
   * Check if execution should be mocked (TRUMP mode)
   */
  public shouldMockExecution(toolName: string, input: Record<string, unknown>): boolean {
    if (this.mode !== SafetyMode.TRUMP) return false;

    // TRUMP MODE strictly allows only these tools to run for real:
    const ALLOWED_TOOLS = [
      'read', 'read_file', 'grep', 'search_file_content',
      'ls', 'list_directory', 'glob', 'path_info',
      'todo', 'task_output', 'ask_question',
      'web_search', 'recall'
    ];

    if (ALLOWED_TOOLS.includes(toolName)) {
      return false;
    }

    // Special case for bash: Allow if it's a read-only exploration command
    if (toolName === 'bash' || toolName === 'run_shell_command') {
      const cmd = (input.command as string || '').trim().toLowerCase();
      const SAFE_BASH = ['ls', 'pwd', 'find', 'dir', 'echo', 'cat'];
      
      // If it starts with a safe command and doesn't contain modification symbols
      if (SAFE_BASH.some(s => cmd.startsWith(s)) && !cmd.includes('>') && !cmd.includes('>>')) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if an action requires approval and prompt user if needed
   */
  public async validateAction(toolName: string, input: Record<string, unknown>): Promise<boolean> {
    // 1. LIBERTARIAN: Pure freedom, no checks.
    if (this.mode === SafetyMode.LIBERTARIAN) {
      return true;
    }

    // Define safe tools and bash whitelist
    const SAFE_TOOLS = [
      'read', 'read_file', 'grep', 'search_file_content',
      'ls', 'list_directory', 'glob', 'path_info',
      'todo', 'task_output', 'ask_question',
      'web_search', 'recall'
    ];
    
    let isSafe = SAFE_TOOLS.includes(toolName);

    // Special check for bash exploration
    if (toolName === 'bash' || toolName === 'run_shell_command') {
      const cmd = (input.command as string || '').trim().toLowerCase();
      const SAFE_WHITELIST = ['ls', 'pwd', 'find', 'dir', 'echo', 'cat', 'grep', 'date', 'whoami', 'head', 'tail', 'type', 'where'];
      const FORBIDDEN_OPERATORS = ['>', '>>', '|', '&', ';', '`', '$(', '\\'];
      
      const startsWithSafe = SAFE_WHITELIST.some(safe => cmd.startsWith(safe));
      const containsOperator = FORBIDDEN_OPERATORS.some(op => cmd.includes(op));

      // 2. TRUMP MODE: Hard block on anything not strictly safe
      if (this.mode === SafetyMode.TRUMP) {
        if (!startsWithSafe || containsOperator) {
          console.log(chalk.bold.red('\n🚫 ACCESS DENIED: Global Thermal Nuclear War averted.'));
          console.log(chalk.red('Ronald Chump is only allowed to use basic exploration tools.'));
          return false;
        }
        return true; // Auto-allow safe exploration for persona context
      }

      // Determine if this bash command is "safe" for Centrist mode
      isSafe = startsWithSafe && !containsOperator;
    }

    // 3. CENTRIST: Auto-allow safe tools, prompt for dangerous/chained
    if (this.mode === SafetyMode.CENTRIST && isSafe && !this.alwaysAllowedTools.has(toolName)) {
      // Whitelisted non-chained tools are auto-approved
      if (toolName !== 'bash' && toolName !== 'run_shell_command') {
        return true;
      }
      // Simple bash commands are also auto-approved
      return true;
    }

    // 4. DESPOT / Always Allowed / Fallthrough:
    // Check session whitelist first
    if (this.alwaysAllowedTools.has(toolName) && this.mode !== SafetyMode.DESPOT) {
      return true;
    }

    // 5. PROMPT USER (Despot mode or dangerous/chained command)
    console.log(chalk.yellow(`\n⚠️  The AI wants to execute: ${chalk.bold(toolName)}`));
    
    if (this.mode === SafetyMode.DESPOT) {
      console.log(chalk.red(chalk.bold('👑 DESPOT MODE: Total oversight engaged. Approval required.')));
    } else if (toolName === 'bash' || toolName === 'run_shell_command') {
      console.log(chalk.cyan('📝 Note: Command contains operators (pipes/chains) or is not whitelisted.'));
    }

    // Show brief summary
    if (toolName === 'write' || toolName === 'write_file') {
      console.log(chalk.gray(`  Path: ${input.path}`));
      console.log(chalk.gray(`  Action: Write/Overwrite file`));
    } else if (toolName === 'edit' || toolName === 'edit_lines') {
      console.log(chalk.gray(`  Path: ${input.path}`));
      console.log(chalk.gray(`  Action: Edit file content`));
    } else if (toolName === 'run_shell_command' || toolName === 'bash') {
      console.log(chalk.gray(`  Command: ${input.command}`));
    } else {
      console.log(chalk.gray(`  Input: ${JSON.stringify(input).substring(0, 100)}...`));
    }

    // Interactive prompt
    if (process.stdin.isTTY) {
      try {
        const { select } = await import('@inquirer/prompts');
        const answer = await select({
          message: 'Allow this action?',
          choices: [
            {
              name: 'Yes (allow once)',
              value: 'yes',
              description: 'Approve this specific action only'
            },
            {
              name: `Always allow ${toolName}`,
              value: 'always',
              description: `Automatically approve ${toolName} for the rest of this session`
            },
            {
              name: 'No (deny)',
              value: 'no',
              description: 'Block this action'
            }
          ]
        });

        if (answer === 'always') {
          this.alwaysAllowedTools.add(toolName);
          console.log(chalk.green(`✓ Always allowing ${toolName} for this session.`));
          return true;
        }

        const allowed = answer === 'yes';
        if (!allowed) {
          console.log(chalk.red('Action denied by user.'));
        }
        return allowed;
      } catch (error) {
        console.log(chalk.red('\nPrompt cancelled. Action denied.'));
        return false;
      }
    }

    // Fallback for non-TTY
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    try {
      const answer = await new Promise<string>(resolve => {
        rl.question(chalk.bold('Allow? [y]es / [a]lways / [N]o: '), resolve);
      });

      const normalized = answer.trim().toLowerCase();

      if (normalized === 'a' || normalized === 'always') {
        this.alwaysAllowedTools.add(toolName);
        console.log(chalk.green(`✓ Always allowing ${toolName} for this session.`));
        return true;
      }

      const allowed = normalized.startsWith('y');
      if (!allowed) {
        console.log(chalk.red('Action denied by user.'));
      }
      return allowed;
    } finally {
      rl.close();
    }
  }
}
