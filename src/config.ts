/**
 * Configuration management system
 * Handles loading from environment, files, and defaults.
 * Now integrated with Secure Secret Manager (Keychain/.env).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { AgenticCliConfig } from './types.js';
import { SecretManager } from './secret-manager.js';

export class ConfigManager {
  private static instance: ConfigManager;
  private config: AgenticCliConfig;
  private configPath: string;
  private secretManager: SecretManager;

  private constructor() {
    const dataDir = join(homedir(), '.freedom-cli');
    this.configPath = join(dataDir, 'config.json');
    this.secretManager = new SecretManager(dataDir);
    
    // Initial sync load (will pick up existing system env vars)
    this.config = this.loadConfig(dataDir);
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  /**
   * Load secrets from Keychain/Env into memory.
   * Call this at startup to ensure keys are available.
   */
  public async loadSecrets(): Promise<void> {
    await this.secretManager.load();
    // Refresh config after loading secrets
    this.config = this.loadConfig(join(homedir(), '.freedom-cli'));
  }

  private loadConfig(dataDir: string): AgenticCliConfig {
    // Ensure data directory exists
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    // Load from file if exists
    let fileConfig: Partial<AgenticCliConfig> = {};
    if (existsSync(this.configPath)) {
      try {
        const content = readFileSync(this.configPath, 'utf-8');
        fileConfig = JSON.parse(content);
      } catch (error) {
        console.warn(`Failed to parse config file: ${error}`);
      }
    }

    // Merge with environment variables and defaults
    const model = process.env.AGENT_MODEL || fileConfig.model || 'claude-sonnet-4-20250514';

    // Auto-detect provider from model name if not specified
    let provider = fileConfig.provider;
    if (!provider) {
      if (model.startsWith('deepseek-')) {
        provider = 'deepseek';
      } else if (model.startsWith('lmstudio-') || model === 'local') {
        provider = 'lmstudio';
      } else if (
        model.startsWith('gemini-') || 
        model.startsWith('auto-gemini-') ||
        model === 'pro' || 
        model === 'flash' || 
        model === 'flash-lite' || 
        model === 'auto'
      ) {
        provider = 'google';
      } else {
        provider = 'anthropic';
      }
    }

    const plugins = {
      enabled: fileConfig.plugins?.enabled ?? true,
      autoLoad: fileConfig.plugins?.autoLoad ?? true,
      paths: fileConfig.plugins?.paths ?? [],
      marketplaces: fileConfig.plugins?.marketplaces ?? [],
    };

    const skills = {
      enabled: fileConfig.skills?.enabled ?? true,
      autoLoad: fileConfig.skills?.autoLoad ?? true,
      paths: fileConfig.skills?.paths ?? [],
      marketplaces: fileConfig.skills?.marketplaces ?? [],
    };

    // Continuous mode config
    const continuousMode = fileConfig.continuousMode ? {
      allowedTools: fileConfig.continuousMode.allowedTools,
      additionalTools: fileConfig.continuousMode.additionalTools ?? [],
      disabledTools: fileConfig.continuousMode.disabledTools ?? [],
      enableMcp: fileConfig.continuousMode.enableMcp ?? false,
      enableWeb: fileConfig.continuousMode.enableWeb ?? false,
    } : undefined;

    const config: AgenticCliConfig = {
      apiKey: process.env.ANTHROPIC_API_KEY || fileConfig.apiKey || '',
      model,
      maxTokens: Number(process.env.AGENT_MAX_TOKENS) || fileConfig.maxTokens || 8192,
      temperature: Number(process.env.AGENT_TEMPERATURE) || fileConfig.temperature || 1.0,
      autoApprove: process.env.AGENT_AUTO_APPROVE === 'true' || fileConfig.autoApprove || false,
      maxTurns: Number(process.env.AGENT_MAX_TURNS) || fileConfig.maxTurns || 25,
      dataDir,
      systemPrompt: fileConfig.systemPrompt,
      mcpServers: fileConfig.mcpServers || {},
      provider,
      deepseekApiKey: process.env.DEEPSEEK_API_KEY || fileConfig.deepseekApiKey,
      lmstudioBaseURL: process.env.LMSTUDIO_BASE_URL || fileConfig.lmstudioBaseURL || 'http://localhost:1234/v1',
      // Compression config
      autoCompact: fileConfig.autoCompact !== undefined ? fileConfig.autoCompact : false,
      compactMethod: fileConfig.compactMethod || 'smart',
      contextLimit: fileConfig.contextLimit || 180000,
      // Quarantine config
      quarantinedPaths: fileConfig.quarantinedPaths || [],
      // Session cleanup config
      sessionCleanup: fileConfig.sessionCleanup || {
        enabled: true,
        maxAge: '30d',
        maxCount: 100,
      },
      plugins,
      skills,
      continuousMode,
      // Disabled tools
      disabledTools: fileConfig.disabledTools || [],
      // Timeout settings
      apiTimeout: fileConfig.apiTimeout || (provider === 'lmstudio' ? 600000 : 180000),
      toolTimeout: fileConfig.toolTimeout || (provider === 'lmstudio' ? 300000 : 120000),
      // LM Studio specific retry settings
      lmstudioRetries: fileConfig.lmstudioRetries || 3,
      lmstudioRetryDelay: fileConfig.lmstudioRetryDelay || 2000,
      // Tool history archival setting
      historyKeepTurns: fileConfig.historyKeepTurns || 2,
      historyKeepInputTurns: fileConfig.historyKeepInputTurns || fileConfig.historyKeepTurns || 2,
      historyKeepOutputTurns: fileConfig.historyKeepOutputTurns || fileConfig.historyKeepTurns || 2,
      historyArchiveLimit: fileConfig.historyArchiveLimit || 500,
      historyOutputLimit: fileConfig.historyOutputLimit || 5000,
      historyInputHeadCharacters: fileConfig.historyInputHeadCharacters || 200,
      historyInputTailCharacters: fileConfig.historyInputTailCharacters || 100,
      apiKeyStorage: fileConfig.apiKeyStorage || 'env',
    };

    // Sync DeepSeek key
    if (provider === 'deepseek') {
      const deepseekKey = config.deepseekApiKey || config.apiKey;
      if (deepseekKey) {
        config.apiKey = deepseekKey;
      }
    }

    if (provider === 'lmstudio') {
      config.apiKey = config.apiKey || 'not-needed';
    }

    if (provider === 'google') {
      config.apiKey = config.apiKey || 'oauth';
    }

    return config;
  }

  public getConfig(): AgenticCliConfig {
    const config = { ...this.config };
    
    // Always re-resolve keys from environment to ensure they are fresh
    if (config.provider === 'deepseek') {
      config.apiKey = process.env.DEEPSEEK_API_KEY || config.deepseekApiKey || config.apiKey;
    } else if (config.provider === 'anthropic') {
      config.apiKey = process.env.ANTHROPIC_API_KEY || config.apiKey;
    }

    return config;
  }

  public async updateConfig(updates: Partial<AgenticCliConfig>): Promise<void> {
    // Determine where to store the API key if it's being updated
    if (updates.apiKey && updates.apiKey !== 'not-needed' && updates.apiKey !== 'oauth') {
      const storage = updates.apiKeyStorage || this.config.apiKeyStorage || 'env';
      
      if (storage === 'env') {
        // Save to secure storage (Keychain + .env fallback)
        const envVarName = (updates.provider === 'deepseek' || this.config.provider === 'deepseek') 
          ? 'DEEPSEEK_API_KEY' 
          : 'ANTHROPIC_API_KEY';
        
        await this.secretManager.save(envVarName, updates.apiKey);
      } else {
        // Save to config.json (legacy/file mode)
        if (updates.provider === 'deepseek' || this.config.provider === 'deepseek') {
          updates.deepseekApiKey = updates.apiKey;
        }
      }
    }
    
    this.config = { ...this.config, ...updates };
    this.saveConfig();
  }

  private saveConfig(): void {
    const { apiKey, ...configToSave } = this.config;
    
    // If storage is 'env', also strip deepseekApiKey from config.json
    if (this.config.apiKeyStorage === 'env') {
      delete (configToSave as any).deepseekApiKey;
    }

    writeFileSync(this.configPath, JSON.stringify(configToSave, null, 2));
  }

  public getDataDir(): string {
    return this.config.dataDir;
  }
}

export function getConfig(): AgenticCliConfig {
  return ConfigManager.getInstance().getConfig();
}

export async function updateConfig(updates: Partial<AgenticCliConfig>): Promise<void> {
  await ConfigManager.getInstance().updateConfig(updates);
}