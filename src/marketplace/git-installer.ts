/**
 * Git installer - handles cloning and updating addons from git repositories
 */

import { simpleGit, SimpleGit, CleanOptions } from 'simple-git';
import { access, mkdir, readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { homedir } from 'os';
import type { GitOperationResult, InstalledAddon } from './marketplace-types.js';

/**
 * Git installer class
 */
export class GitInstaller {
  private installDir: string;
  private git: SimpleGit;
  private installedAddonsFile: string;

  constructor(installDir?: string) {
    // Default to ~/.freedom-cli/addons
    this.installDir = installDir || join(homedir(), '.freedom-cli', 'addons');
    this.installedAddonsFile = join(this.installDir, '.installed.json');
    this.git = simpleGit();
  }

  /**
   * Get the installation directory
   */
  getInstallDir(): string {
    return this.installDir;
  }

  /**
   * Ensure installation directory exists
   */
  private async ensureInstallDir(): Promise<void> {
    try {
      await access(this.installDir);
    } catch {
      await mkdir(this.installDir, { recursive: true });
    }
  }

  /**
   * Load installed addons registry
   */
  private async loadInstalledAddons(): Promise<InstalledAddon[]> {
    try {
      const content = await readFile(this.installedAddonsFile, 'utf-8');
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  /**
   * Save installed addons registry
   */
  private async saveInstalledAddons(addons: InstalledAddon[]): Promise<void> {
    await this.ensureInstallDir();
    await writeFile(this.installedAddonsFile, JSON.stringify(addons, null, 2));
  }

  /**
   * Install addon from git repository
   */
  async installFromGit(
    gitUrl: string,
    name: string,
    options?: {
      branch?: string;
      tag?: string;
      subdir?: string;
      marketplace?: string;
    }
  ): Promise<GitOperationResult> {
    try {
      await this.ensureInstallDir();

      const repoRoot = join(this.installDir, name);
      const addonPath = options?.subdir ? join(repoRoot, options.subdir) : repoRoot;

      // Check if already exists
      try {
        await access(repoRoot);
        return {
          success: false,
          error: `Addon '${name}' is already installed at ${repoRoot}`,
        };
      } catch {
        // Doesn't exist, proceed with installation
      }

      // Clone the repository
      console.log(`Cloning ${gitUrl}...`);
      await this.git.clone(gitUrl, repoRoot, [
        '--depth', '1', // Shallow clone
        ...(options?.branch ? ['--branch', options.branch] : []),
      ]);

      // If tag specified, checkout tag
      if (options?.tag) {
        const repoGit = simpleGit(repoRoot);
        await repoGit.checkout(options.tag);
      }

      if (options?.subdir) {
        try {
          await access(addonPath);
        } catch {
          return {
            success: false,
            error: `Addon subdir not found in repo: ${options.subdir}`,
          };
        }
      }

      // Register installation
      const installed = await this.loadInstalledAddons();
      installed.push({
        name,
        type: 'git',
        path: addonPath,
        repoRoot,
        subdir: options?.subdir,
        sourceUrl: gitUrl,
        branch: options?.branch,
        installedAt: Date.now(),
        marketplace: options?.marketplace,
      });
      await this.saveInstalledAddons(installed);

      return {
        success: true,
        path: addonPath,
        message: `Successfully installed '${name}' from ${gitUrl}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to install from git: ${error.message}`,
      };
    }
  }

  /**
   * Update an installed git addon
   */
  async updateAddon(name: string): Promise<GitOperationResult> {
    try {
      const installed = await this.loadInstalledAddons();
      const addon = installed.find((a) => a.name === name);

      if (!addon) {
        return {
          success: false,
          error: `Addon '${name}' is not installed`,
        };
      }

      if (addon.type !== 'git') {
        return {
          success: false,
          error: `Addon '${name}' is not a git installation, cannot update`,
        };
      }

      // Check if directory exists
      const repoRoot = addon.repoRoot || addon.path;
      try {
        await access(repoRoot);
      } catch {
        return {
          success: false,
          error: `Addon directory not found: ${repoRoot}`,
        };
      }

      // Pull latest changes
      console.log(`Updating ${name}...`);
      const repoGit = simpleGit(repoRoot);
      await repoGit.pull();

      // Update registry
      addon.updatedAt = Date.now();
      await this.saveInstalledAddons(installed);

      return {
        success: true,
        path: addon.path,
        message: `Successfully updated '${name}'`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to update addon: ${error.message}`,
      };
    }
  }

  /**
   * Update all git-based addons
   */
  async updateAllAddons(): Promise<GitOperationResult[]> {
    const installed = await this.loadInstalledAddons();
    const gitAddons = installed.filter((a) => a.type === 'git');

    const results: GitOperationResult[] = [];
    for (const addon of gitAddons) {
      const result = await this.updateAddon(addon.name);
      results.push(result);
    }

    return results;
  }

  /**
   * Remove an installed addon
   */
  async removeAddon(name: string): Promise<GitOperationResult> {
    try {
      const installed = await this.loadInstalledAddons();
      const addonIndex = installed.findIndex((a) => a.name === name);

      if (addonIndex === -1) {
        return {
          success: false,
          error: `Addon '${name}' is not installed`,
        };
      }

      const addon = installed[addonIndex];

      // Remove from registry
      installed.splice(addonIndex, 1);
      await this.saveInstalledAddons(installed);

      // Note: We don't delete the directory to be safe
      // User can manually delete if needed

      const repoRoot = addon.repoRoot || addon.path;
      return {
        success: true,
        message: `Unregistered '${name}'. Directory remains at: ${repoRoot}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to remove addon: ${error.message}`,
      };
    }
  }

  /**
   * Check if an addon is installed
   */
  async isInstalled(name: string): Promise<boolean> {
    const installed = await this.loadInstalledAddons();
    return installed.some((a) => a.name === name);
  }

  /**
   * Get installed addon info
   */
  async getInstalledAddon(name: string): Promise<InstalledAddon | undefined> {
    const installed = await this.loadInstalledAddons();
    return installed.find((a) => a.name === name);
  }

  /**
   * Get all installed addons
   */
  async listInstalled(): Promise<InstalledAddon[]> {
    return await this.loadInstalledAddons();
  }

  /**
   * Get addon path
   */
  getAddonPath(name: string): string {
    return join(this.installDir, name);
  }
}

/**
 * Global git installer instance
 */
export const gitInstaller = new GitInstaller();
