/**
 * Skills system - Claude Code compatibility layer
 * Exports all skills functionality
 */

export { SkillLoader } from './skill-loader.js';
export { skillContextManager, SkillContextManager } from './skill-context.js';
export { parseSkillFile, parseMarketplaceFile, isSkillFile } from './skill-parser.js';

import { SkillLoader } from './skill-loader.js';
import { skillContextManager } from './skill-context.js';
export type {
  SkillMetadata,
  LoadedSkill,
  SkillsConfig,
  SkillMarketplaceEntry,
  SkillMarketplace,
} from './skill-types.js';

/**
 * Initialize skills system - loads skills from config paths and marketplaces
 */
export async function initializeSkills(config: {
  enabled?: boolean;
  autoLoad?: boolean;
  paths?: string[];
  marketplaces?: string[];
}): Promise<void> {
  // Skip if skills disabled or no config
  if (config.enabled === false || !config.autoLoad) {
    return;
  }

  const loader = new SkillLoader();
  const loadedCount = { skills: 0, errors: 0 };

  // Load from configured paths
  if (config.paths && config.paths.length > 0) {
    for (const path of config.paths) {
      try {
        const skills = await loader.loadSkillsFromDirectory(path);
        for (const skill of skills) {
          skillContextManager.registerSkill(skill);
          // Auto-activate all loaded skills
          skillContextManager.activateSkill(skill.metadata.name);
          loadedCount.skills++;
        }
      } catch (error: any) {
        console.error(`Warning: Failed to load skills from ${path}: ${error.message}`);
        loadedCount.errors++;
      }
    }
  }

  // Load from marketplaces
  if (config.marketplaces && config.marketplaces.length > 0) {
    for (const marketplacePath of config.marketplaces) {
      try {
        const skills = await loader.loadSkillsFromMarketplace(marketplacePath);
        for (const skill of skills) {
          skillContextManager.registerSkill(skill);
          // Auto-activate all loaded skills
          skillContextManager.activateSkill(skill.metadata.name);
          loadedCount.skills++;
        }
      } catch (error: any) {
        console.error(`Warning: Failed to load skills from marketplace ${marketplacePath}: ${error.message}`);
        loadedCount.errors++;
      }
    }
  }

  // Log results if any skills loaded
  if (loadedCount.skills > 0) {
    console.log(`✓ Loaded ${loadedCount.skills} skill(s)`);
    if (loadedCount.errors > 0) {
      console.log(`⚠ ${loadedCount.errors} error(s) while loading skills`);
    }
  }
}
