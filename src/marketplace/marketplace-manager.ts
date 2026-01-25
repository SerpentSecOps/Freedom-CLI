/**
 * Marketplace manager - high-level marketplace and addon operations
 */

import type {
  Marketplace,
  MarketplaceEntry,
  AddonInstallResult,
} from './marketplace-types.js';
import {
  parseMarketplace,
  resolveSourceType,
  findEntryByName,
  searchMarketplace,
  getMarketplaceDirectory,
} from './marketplace-parser.js';
import { GitInstaller } from './git-installer.js';
import { SkillLoader } from '../skills/skill-loader.js';
import { PluginLoader } from '../plugins/plugin-loader.js';
import { skillContextManager } from '../skills/skill-context.js';
import { pluginManager } from '../plugins/index.js';

/**
 * Marketplace manager class
 */
export class MarketplaceManager {
  private marketplaces: Map<string, Marketplace> = new Map();
  private gitInstaller: GitInstaller;
  private skillLoader: SkillLoader;
  private pluginLoader: PluginLoader;

  constructor(gitInstaller?: GitInstaller) {
    this.gitInstaller = gitInstaller || new GitInstaller();
    this.skillLoader = new SkillLoader();
    this.pluginLoader = new PluginLoader();
  }

  /**
   * Load marketplaces from config
   */
  async loadFromConfig(): Promise<void> {
    try {
      const { getConfig } = await import('../config.js');
      const config = getConfig();

      const marketplacePaths: string[] = [];

      // Collect marketplace paths from both plugins and skills config
      if (config.plugins?.marketplaces) {
        marketplacePaths.push(...config.plugins.marketplaces);
      }
      if (config.skills?.marketplaces) {
        marketplacePaths.push(...config.skills.marketplaces);
      }

      // Load each marketplace (skip duplicates)
      const loaded = new Set<string>();
      for (const path of marketplacePaths) {
        if (!loaded.has(path)) {
          try {
            // Use internal method to avoid re-saving to config
            await this.loadMarketplace(path);
            loaded.add(path);
          } catch (error: any) {
            console.warn(`Failed to load marketplace from ${path}: ${error.message}`);
          }
        }
      }
    } catch (error) {
      // Silently fail - not critical
      console.warn('Failed to load marketplaces from config:', error);
    }
  }

  /**
   * Internal method to load a marketplace without saving to config
   */
  private async loadMarketplace(marketplacePath: string): Promise<void> {
    const marketplace = await parseMarketplace(marketplacePath);
    this.marketplaces.set(marketplace.name, marketplace);
  }

  /**
   * Add a marketplace
   * Supports:
   * - Full paths: /path/to/marketplace.json
   * - Full URLs: https://github.com/user/repo/raw/main/marketplace.json
   * - GitHub shorthand: user/repo (expands to https://github.com/user/repo.git)
   */
  async addMarketplace(marketplacePath: string): Promise<void> {
    let resolvedPath = marketplacePath;
    let isGitUrl = false;

    // Check if it's a git URL
    if (marketplacePath.startsWith('http') ||
        marketplacePath.startsWith('git@') ||
        (marketplacePath.includes('github.com') && !marketplacePath.startsWith('/'))) {
      isGitUrl = true;
    }
    // If it's a shorthand like "user/repo" or "org/project"
    // Convert to GitHub git URL
    else if (!marketplacePath.startsWith('/') &&
        marketplacePath.includes('/') &&
        !marketplacePath.endsWith('.json')) {
      // It's a GitHub shorthand like "anthropics/claude-code"
      resolvedPath = `https://github.com/${marketplacePath}.git`;
      isGitUrl = true;
    }

    // If it's a git URL, fetch marketplace.json via raw GitHub URL
    if (isGitUrl) {
      const { existsSync, mkdirSync, writeFileSync } = await import('fs');
      const { join } = await import('path');
      const { homedir } = await import('os');

      // Extract repo name from URL
      const repoName = this.extractNameFromGitUrl(resolvedPath);

      // Convert git URL to raw GitHub URL for marketplace.json
      // https://github.com/user/repo.git -> https://raw.githubusercontent.com/user/repo/main/.claude-plugin/marketplace.json
      let rawUrl: string | undefined;
      let rawBranch: string | undefined;

      if (resolvedPath.includes('github.com')) {
        // Extract owner and repo from git URL
        const match = resolvedPath.match(/github\.com[:/]([^/]+)\/([^/.]+)(\.git)?/);
        if (match) {
          const owner = match[1];
          const repo = match[2];

          // Try common locations for marketplace.json
          const possiblePaths = [
            `.claude-plugin/marketplace.json`,
            `marketplace.json`,
            `.claude/marketplace.json`,
          ];

          // Try main branch first, then master
          const branches = ['main', 'master'];

          for (const branch of branches) {
            for (const path of possiblePaths) {
              const testUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;

              try {
                // Try to fetch the file
                const https = await import('https');
                const response = await new Promise<any>((resolve, reject) => {
                  https.get(testUrl, (res) => {
                    if (res.statusCode === 200) {
                      resolve(res);
                    } else {
                      reject(new Error(`HTTP ${res.statusCode}`));
                    }
                  }).on('error', reject);
                });

                // Success! Use this URL
                rawUrl = testUrl;
                rawBranch = branch;
                console.log(`Found marketplace.json at ${rawUrl}`);
                break;
              } catch (error) {
                // Try next location
                continue;
              }
            }
            if (rawUrl) break;
          }
        }
      }

      if (!rawUrl) {
        throw new Error(`Could not find marketplace.json in repository. Tried common locations in main/master branches.`);
      }

      // Download and cache the marketplace.json
      const marketplacesDir = join(homedir(), '.freedom-cli', 'marketplaces');
      mkdirSync(marketplacesDir, { recursive: true });

      const cachedPath = join(marketplacesDir, `${repoName}-marketplace.json`);

      // Fetch the file
      const https = await import('https');
      const content = await new Promise<string>((resolve, reject) => {
        let data = '';
        https.get(rawUrl!, (res) => {
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => resolve(data));
        }).on('error', reject);
      });

      // Cache it locally (include source repo info for relative paths)
      const parsed = JSON.parse(content);
      parsed.freedom = {
        ...(parsed.freedom || {}),
        sourceRepo: {
          url: resolvedPath,
          branch: rawBranch,
        },
      };
      writeFileSync(cachedPath, JSON.stringify(parsed, null, 2), 'utf-8');

      resolvedPath = cachedPath;
    }

    const marketplace = await parseMarketplace(resolvedPath);
    this.marketplaces.set(marketplace.name, marketplace);

    // Save to config for persistence (use the resolved/cached path)
    await this.saveMarketplaceToConfig(resolvedPath);
  }

  /**
   * Save marketplace path to config
   */
  private async saveMarketplaceToConfig(marketplacePath: string): Promise<void> {
    try {
      const { getConfig, updateConfig } = await import('../config.js');
      const config = getConfig();

      // Initialize plugins config if it doesn't exist
      const pluginsConfig = config.plugins || {
        enabled: true,
        autoLoad: true,
        paths: [],
        marketplaces: []
      };

      // Ensure marketplaces array exists
      if (!pluginsConfig.marketplaces) {
        pluginsConfig.marketplaces = [];
      }

      // Add if not already present
      if (!pluginsConfig.marketplaces.includes(marketplacePath)) {
        pluginsConfig.marketplaces.push(marketplacePath);
        updateConfig({ plugins: pluginsConfig });
      }
    } catch (error: any) {
      // Silently fail - not critical
      console.warn('Failed to save marketplace to config:', error.message);
    }
  }

  /**
   * Remove a marketplace
   */
  removeMarketplace(name: string): boolean {
    return this.marketplaces.delete(name);
  }

  /**
   * Remove a marketplace and persist removal to config
   */
  async removeMarketplaceAndConfig(nameOrPath: string): Promise<boolean> {
    const target = this.findMarketplaceByNameOrPath(nameOrPath);
    if (!target) {
      return false;
    }

    this.marketplaces.delete(target.name);
    await this.removeMarketplaceFromConfig(target.path);
    return true;
  }

  /**
   * Get a marketplace by name
   */
  getMarketplace(name: string): Marketplace | undefined {
    return this.marketplaces.get(name);
  }

  /**
   * Get all marketplaces
   */
  getAllMarketplaces(): Marketplace[] {
    return Array.from(this.marketplaces.values());
  }

  private findMarketplaceByNameOrPath(nameOrPath: string): Marketplace | undefined {
    const direct = this.marketplaces.get(nameOrPath);
    if (direct) {
      return direct;
    }

    const normalized = nameOrPath.trim();
    for (const marketplace of this.marketplaces.values()) {
      if (marketplace.path === normalized || marketplace.name === normalized) {
        return marketplace;
      }
    }

    return undefined;
  }

  private async removeMarketplaceFromConfig(marketplacePath?: string): Promise<void> {
    if (!marketplacePath) {
      return;
    }

    try {
      const { getConfig, updateConfig } = await import('../config.js');
      const config = getConfig();

      const pluginsConfig = config.plugins || {
        enabled: true,
        autoLoad: true,
        paths: [],
        marketplaces: []
      };

      const skillsConfig = config.skills || {
        enabled: true,
        autoLoad: true,
        paths: [],
        marketplaces: []
      };

      const removeFromList = (list?: string[]) =>
        list ? list.filter((entry) => entry !== marketplacePath) : list;

      pluginsConfig.marketplaces = removeFromList(pluginsConfig.marketplaces) || [];
      skillsConfig.marketplaces = removeFromList(skillsConfig.marketplaces) || [];

      updateConfig({ plugins: pluginsConfig, skills: skillsConfig });
    } catch (error: any) {
      console.warn('Failed to remove marketplace from config:', error.message);
    }
  }

  /**
   * Find an addon across all marketplaces
   */
  findAddon(name: string): { marketplace: Marketplace; entry: MarketplaceEntry } | undefined {
    for (const marketplace of this.marketplaces.values()) {
      const entry = findEntryByName(marketplace, name);
      if (entry) {
        return { marketplace, entry };
      }
    }
    return undefined;
  }

  /**
   * Search all marketplaces
   */
  searchAllMarketplaces(query: string): Array<{
    marketplace: Marketplace;
    entries: MarketplaceEntry[];
  }> {
    const results: Array<{ marketplace: Marketplace; entries: MarketplaceEntry[] }> = [];

    for (const marketplace of this.marketplaces.values()) {
      const entries = searchMarketplace(marketplace, query);
      if (entries.length > 0) {
        results.push({ marketplace, entries });
      }
    }

    return results;
  }

  /**
   * Install an addon from a marketplace
   */
  async installAddon(
    addonName: string,
    marketplaceName?: string
  ): Promise<AddonInstallResult> {
    // Find the addon
    let marketplace: Marketplace | undefined;
    let entry: MarketplaceEntry | undefined;

    if (marketplaceName) {
      marketplace = this.marketplaces.get(marketplaceName);
      if (!marketplace) {
        return {
          success: false,
          name: addonName,
          error: `Marketplace '${marketplaceName}' not found`,
        };
      }
      entry = findEntryByName(marketplace, addonName);
    } else {
      // Search all marketplaces
      const found = this.findAddon(addonName);
      if (found) {
        marketplace = found.marketplace;
        entry = found.entry;
      }
    }

    if (!entry || !marketplace) {
      return {
        success: false,
        name: addonName,
        error: `Addon '${addonName}' not found in any marketplace`,
      };
    }

    // Resolve source
    const marketplaceDir = marketplace.path
      ? getMarketplaceDirectory(marketplace.path)
      : undefined;
    const sourceInfo = resolveSourceType(entry.source, marketplaceDir, marketplace.sourceRepo);

    // Install based on type
    if (sourceInfo.type === 'git') {
      // Clone from git
      const result = await this.gitInstaller.installFromGit(
        sourceInfo.location,
        addonName,
        {
          branch: sourceInfo.branch,
          tag: sourceInfo.tag,
          subdir: sourceInfo.subdir,
          marketplace: marketplace.name,
        }
      );

      if (!result.success) {
        return {
          success: false,
          name: addonName,
          error: result.error,
        };
      }

      // Load the addon and LSP servers
      const loadResult = await this.loadAddon(result.path!, addonName);

      // Load LSP servers if defined in marketplace entry
      if (loadResult.success && entry.lspServers) {
        await this.loadLSPServers(result.path!, entry.lspServers);
      }

      return loadResult;
    } else {
      // Local path - load addon and LSP servers
      const loadResult = await this.loadAddon(sourceInfo.location, addonName);

      if (loadResult.success && entry.lspServers) {
        await this.loadLSPServers(sourceInfo.location, entry.lspServers);
      }

      return loadResult;
    }
  }

  /**
   * Install directly from a git URL
   */
  async installFromGit(
    gitUrl: string,
    name?: string
  ): Promise<AddonInstallResult> {
    // Extract name from URL if not provided
    const addonName = name || this.extractNameFromGitUrl(gitUrl);

    const result = await this.gitInstaller.installFromGit(gitUrl, addonName);

    if (!result.success) {
      return {
        success: false,
        name: addonName,
        error: result.error,
      };
    }

    // Load the addon
    return await this.loadAddon(result.path!, addonName);
  }

  /**
   * Load an addon from a path (determine if skill or plugin)
   */
  private async loadAddon(
    path: string,
    name: string
  ): Promise<AddonInstallResult> {
    try {
      // Check if it's a plugin
      const isPlugin = await this.pluginLoader.isPluginDirectory(path);

      if (isPlugin) {
        const plugin = await this.pluginLoader.loadPlugin(path);
        pluginManager.registerPlugin(plugin);
        pluginManager.activatePlugin(plugin.manifest.name);

        return {
          success: true,
          name,
          path,
          type: 'plugin',
          message: `Successfully loaded plugin '${name}'`,
        };
      }

      // Check if it's a skill
      const isSkill = await this.skillLoader.isSkillDirectory(path);

      if (isSkill) {
        const skill = await this.skillLoader.loadSkill(path);
        skillContextManager.registerSkill(skill);
        skillContextManager.activateSkill(skill.metadata.name);

        return {
          success: true,
          name,
          path,
          type: 'skill',
          message: `Successfully loaded skill '${name}'`,
        };
      }

      return {
        success: false,
        name,
        error: 'Addon is neither a valid plugin nor a skill',
      };
    } catch (error: any) {
      return {
        success: false,
        name,
        error: `Failed to load addon: ${error.message}`,
      };
    }
  }

  /**
   * Update an installed addon
   */
  async updateAddon(name: string): Promise<AddonInstallResult> {
    const result = await this.gitInstaller.updateAddon(name);

    if (!result.success) {
      return {
        success: false,
        name,
        error: result.error,
      };
    }

    return {
      success: true,
      name,
      message: result.message,
    };
  }

  /**
   * Update all installed addons
   */
  async updateAllAddons(): Promise<AddonInstallResult[]> {
    const results = await this.gitInstaller.updateAllAddons();
    return results.map((r) => ({
      success: r.success,
      name: r.path || 'unknown',
      message: r.message,
      error: r.error,
    }));
  }

  /**
   * Remove an addon
   */
  async removeAddon(name: string): Promise<AddonInstallResult> {
    const result = await this.gitInstaller.removeAddon(name);

    // Also unregister from managers
    pluginManager.unregisterPlugin(name);
    skillContextManager.unregisterSkill(name);

    return {
      success: result.success,
      name,
      message: result.message,
      error: result.error,
    };
  }

  /**
   * List installed addons
   */
  async listInstalledAddons() {
    return await this.gitInstaller.listInstalled();
  }

  /**
   * List available addons from all marketplaces
   */
  listAvailableAddons(): Array<{
    marketplace: string;
    entries: MarketplaceEntry[];
  }> {
    const results: Array<{ marketplace: string; entries: MarketplaceEntry[] }> = [];

    for (const marketplace of this.marketplaces.values()) {
      results.push({
        marketplace: marketplace.name,
        entries: marketplace.plugins,
      });
    }

    return results;
  }

  /**
   * Extract addon name from git URL
   */
  private extractNameFromGitUrl(url: string): string {
    // Extract from URLs like:
    // https://github.com/user/repo.git -> repo
    // git@github.com:user/repo.git -> repo
    const match = url.match(/\/([^/]+?)(\.git)?$/);
    return match ? match[1] : 'addon';
  }

  /**
   * Get installer instance (for direct access)
   */
  getInstaller(): GitInstaller {
    return this.gitInstaller;
  }

  /**
   * Load LSP servers from marketplace entry
   */
  private async loadLSPServers(
    addonPath: string,
    lspServers: Record<string, any>
  ): Promise<void> {
    try {
      const { loadPluginLSPServers } = await import('../lsp/index.js');
      await loadPluginLSPServers(addonPath, lspServers);
    } catch (error: any) {
      console.error(`Warning: Failed to load LSP servers: ${error.message}`);
    }
  }
}

/**
 * Global marketplace manager instance
 */
export const marketplaceManager = new MarketplaceManager();
