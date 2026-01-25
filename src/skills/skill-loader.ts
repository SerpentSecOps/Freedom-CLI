/**
 * Skill loader - discovers and loads SKILL.md files
 */

import { readdir, stat, access } from 'fs/promises';
import { join, dirname, resolve } from 'path';
import fg from 'fast-glob';
import type { LoadedSkill, SkillMarketplace } from './skill-types.js';
import { parseSkillFile, parseMarketplaceFile, isSkillFile } from './skill-parser.js';

export class SkillLoader {
  /**
   * Load a single skill from a SKILL.md file
   */
  async loadSkill(skillPath: string): Promise<LoadedSkill> {
    const absolutePath = resolve(skillPath);

    // Parse the SKILL.md file
    const { metadata, content } = await parseSkillFile(absolutePath);

    // Discover reference files in the same directory
    const skillDir = dirname(absolutePath);
    const referencePaths = await this.discoverReferenceFiles(skillDir);

    return {
      metadata: {
        ...metadata,
        path: absolutePath,
      },
      content,
      referencePaths,
      active: false,
    };
  }

  /**
   * Load all skills from a directory
   */
  async loadSkillsFromDirectory(directory: string): Promise<LoadedSkill[]> {
    const skills: LoadedSkill[] = [];
    const absoluteDir = resolve(directory);

    try {
      // Check if directory exists
      await access(absoluteDir);

      // Find all SKILL.md files recursively
      const skillFiles = await fg('**/SKILL.md', {
        cwd: absoluteDir,
        absolute: true,
        dot: true,
      });

      // Load each skill
      for (const skillFile of skillFiles) {
        try {
          const skill = await this.loadSkill(skillFile);
          skills.push(skill);
        } catch (error: any) {
          console.error(`Failed to load skill from ${skillFile}: ${error.message}`);
        }
      }
    } catch (error: any) {
      throw new Error(`Failed to load skills from directory ${directory}: ${error.message}`);
    }

    return skills;
  }

  /**
   * Load skills from a marketplace.json file
   */
  async loadSkillsFromMarketplace(marketplacePath: string): Promise<LoadedSkill[]> {
    const skills: LoadedSkill[] = [];
    const absolutePath = resolve(marketplacePath);
    const marketplaceDir = dirname(absolutePath);

    try {
      // Parse marketplace.json
      const marketplace: SkillMarketplace = await parseMarketplaceFile(absolutePath);

      // Process each plugin that contains skills
      for (const plugin of marketplace.plugins || []) {
        if (plugin.skills && Array.isArray(plugin.skills)) {
          for (const skillPath of plugin.skills) {
            // Resolve skill path relative to marketplace directory
            const fullSkillPath = join(marketplaceDir, plugin.source || '', skillPath, 'SKILL.md');

            try {
              const skill = await this.loadSkill(fullSkillPath);
              skills.push(skill);
            } catch (error: any) {
              console.error(`Failed to load skill from marketplace: ${fullSkillPath}: ${error.message}`);
            }
          }
        }
      }
    } catch (error: any) {
      throw new Error(`Failed to load skills from marketplace ${marketplacePath}: ${error.message}`);
    }

    return skills;
  }

  /**
   * Discover reference files in a skill directory
   * Looks for common reference files like forms.md, reference.md, etc.
   */
  private async discoverReferenceFiles(skillDir: string): Promise<string[]> {
    const referenceFiles: string[] = [];
    const commonReferenceNames = ['forms.md', 'reference.md', 'examples.md', 'guide.md'];

    try {
      const files = await readdir(skillDir);

      for (const file of files) {
        const filePath = join(skillDir, file);
        const fileStat = await stat(filePath);

        // Check if it's a markdown file (but not SKILL.md)
        if (fileStat.isFile() && file.endsWith('.md') && file !== 'SKILL.md') {
          // Prioritize common reference files
          if (commonReferenceNames.includes(file.toLowerCase())) {
            referenceFiles.unshift(filePath);
          } else {
            referenceFiles.push(filePath);
          }
        }
      }
    } catch (error: any) {
      // Directory might not exist or be readable, that's okay
      console.debug(`Could not read skill directory ${skillDir}: ${error.message}`);
    }

    return referenceFiles;
  }

  /**
   * Check if a path is a skill directory (contains SKILL.md)
   */
  async isSkillDirectory(directory: string): Promise<boolean> {
    try {
      const skillFilePath = join(directory, 'SKILL.md');
      await access(skillFilePath);
      return true;
    } catch {
      return false;
    }
  }
}
