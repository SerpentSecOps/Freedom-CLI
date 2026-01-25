/**
 * Toolkit Manager - handles installing, listing, and removing toolkits
 *
 * Toolkits are stored in ~/.freedom-cli/toolkits/
 * Each toolkit is a folder containing CLI tools and a tool_docs/ directory
 */

import { access, mkdir, readdir, readFile, writeFile, cp, rm, stat } from 'fs/promises';
import { join, basename, resolve } from 'path';
import { homedir } from 'os';
import type {
  InstalledToolkit,
  ToolkitOperationResult,
  ToolkitManifest,
} from './toolkit-types.js';

/**
 * Normalize a name for use as a toolkit folder name
 * - Converts spaces to dashes
 * - Converts to lowercase
 * - Removes special characters
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export class ToolkitManager {
  private toolkitsDir: string;
  private registryFile: string;

  constructor(toolkitsDir?: string) {
    // Default to ~/.freedom-cli/toolkits
    this.toolkitsDir = toolkitsDir || join(homedir(), '.freedom-cli', 'toolkits');
    this.registryFile = join(this.toolkitsDir, '.installed.json');
  }

  /**
   * Get the toolkits directory path
   */
  getToolkitsDir(): string {
    return this.toolkitsDir;
  }

  /**
   * Ensure the toolkits directory exists
   */
  private async ensureToolkitsDir(): Promise<void> {
    try {
      await access(this.toolkitsDir);
    } catch {
      await mkdir(this.toolkitsDir, { recursive: true });
    }
  }

  /**
   * Load the installed toolkits registry
   */
  private async loadRegistry(): Promise<InstalledToolkit[]> {
    try {
      const content = await readFile(this.registryFile, 'utf-8');
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  /**
   * Save the installed toolkits registry
   */
  private async saveRegistry(toolkits: InstalledToolkit[]): Promise<void> {
    await this.ensureToolkitsDir();
    await writeFile(this.registryFile, JSON.stringify(toolkits, null, 2));
  }

  /**
   * Read toolkit manifest if it exists
   */
  private async readManifest(toolkitPath: string): Promise<ToolkitManifest | null> {
    try {
      const manifestPath = join(toolkitPath, 'toolkit.json');
      const content = await readFile(manifestPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Add a toolkit from a source folder
   *
   * @param sourcePath - Path to the folder containing the toolkit
   * @param customName - Optional custom name (otherwise uses folder basename)
   */
  async addToolkit(
    sourcePath: string,
    customName?: string
  ): Promise<ToolkitOperationResult> {
    try {
      await this.ensureToolkitsDir();

      // Resolve the source path
      const absoluteSource = resolve(sourcePath);

      // Check source exists and is a directory
      try {
        const sourceStat = await stat(absoluteSource);
        if (!sourceStat.isDirectory()) {
          return {
            success: false,
            error: `Source path is not a directory: ${absoluteSource}`,
          };
        }
      } catch {
        return {
          success: false,
          error: `Source path does not exist: ${absoluteSource}`,
        };
      }

      // Determine the toolkit name
      const rawName = customName || basename(absoluteSource);
      const name = normalizeName(rawName);

      if (!name) {
        return {
          success: false,
          error: 'Could not determine a valid toolkit name',
        };
      }

      const destPath = join(this.toolkitsDir, name);

      // Check if already installed
      try {
        await access(destPath);
        return {
          success: false,
          error: `Toolkit '${name}' is already installed at ${destPath}`,
        };
      } catch {
        // Doesn't exist, good to proceed
      }

      // Copy the toolkit folder
      await cp(absoluteSource, destPath, { recursive: true });

      // Try to read manifest for description
      const manifest = await this.readManifest(destPath);

      // Register the toolkit
      const toolkits = await this.loadRegistry();
      toolkits.push({
        name,
        path: destPath,
        sourcePath: absoluteSource,
        installedAt: Date.now(),
        description: manifest?.description,
      });
      await this.saveRegistry(toolkits);

      return {
        success: true,
        name,
        path: destPath,
        message: `Successfully added toolkit '${name}' from ${absoluteSource}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to add toolkit: ${error.message}`,
      };
    }
  }

  /**
   * Remove an installed toolkit
   */
  async removeToolkit(name: string): Promise<ToolkitOperationResult> {
    try {
      const toolkits = await this.loadRegistry();
      const index = toolkits.findIndex(
        (t) => t.name.toLowerCase() === name.toLowerCase()
      );

      if (index === -1) {
        return {
          success: false,
          error: `Toolkit '${name}' is not installed`,
        };
      }

      const toolkit = toolkits[index];

      // Remove the directory
      try {
        await rm(toolkit.path, { recursive: true, force: true });
      } catch (error: any) {
        // Log but don't fail - directory might already be gone
        console.warn(`Warning: Could not remove toolkit directory: ${error.message}`);
      }

      // Remove from registry
      toolkits.splice(index, 1);
      await this.saveRegistry(toolkits);

      return {
        success: true,
        name: toolkit.name,
        message: `Successfully removed toolkit '${toolkit.name}'`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to remove toolkit: ${error.message}`,
      };
    }
  }

  /**
   * List all installed toolkits
   */
  async listToolkits(): Promise<InstalledToolkit[]> {
    return await this.loadRegistry();
  }

  /**
   * Get information about a specific toolkit
   */
  async getToolkit(name: string): Promise<InstalledToolkit | undefined> {
    const toolkits = await this.loadRegistry();
    return toolkits.find((t) => t.name.toLowerCase() === name.toLowerCase());
  }

  /**
   * Check if a toolkit is installed
   */
  async isInstalled(name: string): Promise<boolean> {
    const toolkit = await this.getToolkit(name);
    return toolkit !== undefined;
  }

  /**
   * Get the path to a toolkit's docs directory
   */
  async getDocsPath(name: string): Promise<string | null> {
    const toolkit = await this.getToolkit(name);
    if (!toolkit) {
      return null;
    }

    // Check for custom docs dir in manifest
    const manifest = await this.readManifest(toolkit.path);
    const docsDir = manifest?.docsDir || 'tool_docs';

    const docsPath = join(toolkit.path, docsDir);

    try {
      await access(docsPath);
      return docsPath;
    } catch {
      // No docs directory
      return null;
    }
  }

  /**
   * List all tools in a toolkit (executable files)
   */
  async listTools(name: string): Promise<string[]> {
    const toolkit = await this.getToolkit(name);
    if (!toolkit) {
      return [];
    }

    const tools: string[] = [];

    try {
      const files = await readdir(toolkit.path);

      for (const file of files) {
        const filePath = join(toolkit.path, file);
        const fileStat = await stat(filePath);

        // Skip directories and hidden files
        if (fileStat.isDirectory() || file.startsWith('.')) {
          continue;
        }

        // Skip common non-tool files
        if (
          file === 'toolkit.json' ||
          file === 'README.md' ||
          file === 'LICENSE'
        ) {
          continue;
        }

        // Check if file is executable (Unix) or has common script extensions
        const isExecutable =
          (fileStat.mode & 0o111) !== 0 ||
          file.endsWith('.sh') ||
          file.endsWith('.py') ||
          file.endsWith('.js') ||
          file.endsWith('.ts');

        if (isExecutable) {
          tools.push(file);
        }
      }
    } catch {
      // Directory might not exist
    }

    return tools;
  }

  /**
   * Get detailed info about a toolkit including its tools and docs
   */
  async getToolkitInfo(name: string): Promise<{
    toolkit: InstalledToolkit;
    manifest: ToolkitManifest | null;
    tools: string[];
    docsPath: string | null;
  } | null> {
    const toolkit = await this.getToolkit(name);
    if (!toolkit) {
      return null;
    }

    const manifest = await this.readManifest(toolkit.path);
    const tools = await this.listTools(name);
    const docsPath = await this.getDocsPath(name);

    return {
      toolkit,
      manifest,
      tools,
      docsPath,
    };
  }
}

/**
 * Global toolkit manager instance
 */
export const toolkitManager = new ToolkitManager();
