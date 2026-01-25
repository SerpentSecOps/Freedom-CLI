/**
 * Skill context manager - handles skill registration and context injection
 */

import { readFile } from 'fs/promises';
import type { LoadedSkill } from './skill-types.js';

export class SkillContextManager {
  private loadedSkills: Map<string, LoadedSkill> = new Map();

  /**
   * Register a skill
   */
  registerSkill(skill: LoadedSkill): void {
    this.loadedSkills.set(skill.metadata.name, skill);
  }

  /**
   * Unregister a skill by name
   */
  unregisterSkill(name: string): boolean {
    return this.loadedSkills.delete(name);
  }

  /**
   * Get a skill by name
   */
  getSkill(name: string): LoadedSkill | undefined {
    return this.loadedSkills.get(name);
  }

  /**
   * Get all loaded skills
   */
  getAllSkills(): LoadedSkill[] {
    return Array.from(this.loadedSkills.values());
  }

  /**
   * Get all active skills
   */
  getActiveSkills(): LoadedSkill[] {
    return Array.from(this.loadedSkills.values()).filter(skill => skill.active);
  }

  /**
   * Activate a skill by name
   */
  activateSkill(name: string): boolean {
    const skill = this.loadedSkills.get(name);
    if (skill) {
      skill.active = true;
      return true;
    }
    return false;
  }

  /**
   * Deactivate a skill by name
   */
  deactivateSkill(name: string): boolean {
    const skill = this.loadedSkills.get(name);
    if (skill) {
      skill.active = false;
      return true;
    }
    return false;
  }

  /**
   * Activate all skills
   */
  activateAllSkills(): void {
    for (const skill of this.loadedSkills.values()) {
      skill.active = true;
    }
  }

  /**
   * Deactivate all skills
   */
  deactivateAllSkills(): void {
    for (const skill of this.loadedSkills.values()) {
      skill.active = false;
    }
  }

  /**
   * Match skills by query - searches in skill descriptions
   * Useful for auto-activating relevant skills based on user input
   */
  matchSkillsByQuery(query: string): LoadedSkill[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.loadedSkills.values()).filter(skill => {
      const desc = skill.metadata.description.toLowerCase();
      const name = skill.metadata.name.toLowerCase();
      return desc.includes(lowerQuery) || name.includes(lowerQuery);
    });
  }

  /**
   * Build the skill context string for injection into system prompt
   * This concatenates all active skill instructions
   */
  async buildSkillContext(): Promise<string> {
    const activeSkills = this.getActiveSkills();

    if (activeSkills.length === 0) {
      return '';
    }

    const sections: string[] = [];

    for (const skill of activeSkills) {
      // Build skill section
      let skillSection = `## Skill: ${skill.metadata.name}\n\n`;

      // Add description
      if (skill.metadata.description) {
        skillSection += `**Description**: ${skill.metadata.description}\n\n`;
      }

      // Add main skill content
      skillSection += `${skill.content}\n`;

      // Add reference files if they exist
      if (skill.referencePaths.length > 0) {
        for (const refPath of skill.referencePaths) {
          try {
            const refContent = await readFile(refPath, 'utf-8');
            skillSection += `\n### Additional Reference\n\n${refContent}\n`;
          } catch (error: any) {
            console.error(`Failed to read reference file ${refPath}: ${error.message}`);
          }
        }
      }

      sections.push(skillSection);
    }

    // Combine all sections
    return `
# Available Skills

The following skills are currently active and provide specialized knowledge:

${sections.join('\n---\n\n')}

`;
  }

  /**
   * Get skill statistics
   */
  getStats(): {
    total: number;
    active: number;
    inactive: number;
  } {
    const total = this.loadedSkills.size;
    const active = this.getActiveSkills().length;
    return {
      total,
      active,
      inactive: total - active,
    };
  }

  /**
   * Clear all skills
   */
  clear(): void {
    this.loadedSkills.clear();
  }
}

// Global singleton instance
export const skillContextManager = new SkillContextManager();
