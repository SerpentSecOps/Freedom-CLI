/**
 * Parser for SKILL.md files with YAML frontmatter
 */

import { readFile } from 'fs/promises';
import matter from 'gray-matter';
import type { SkillMetadata } from './skill-types.js';

/**
 * Parse a SKILL.md file and extract metadata and content
 */
export async function parseSkillFile(filePath: string): Promise<{
  metadata: Omit<SkillMetadata, 'path'>;
  content: string;
}> {
  try {
    const fileContent = await readFile(filePath, 'utf-8');
    const parsed = matter(fileContent);

    // Extract metadata from frontmatter
    const metadata: Omit<SkillMetadata, 'path'> = {
      name: parsed.data.name || '',
      description: parsed.data.description || '',
      license: parsed.data.license,
    };

    // Validate required fields
    if (!metadata.name) {
      throw new Error(`Skill file ${filePath} is missing required 'name' field in frontmatter`);
    }
    if (!metadata.description) {
      throw new Error(`Skill file ${filePath} is missing required 'description' field in frontmatter`);
    }

    return {
      metadata,
      content: parsed.content.trim(),
    };
  } catch (error: any) {
    throw new Error(`Failed to parse skill file ${filePath}: ${error.message}`);
  }
}

/**
 * Check if a file is a valid SKILL.md file
 */
export function isSkillFile(fileName: string): boolean {
  return fileName === 'SKILL.md' || fileName.endsWith('/SKILL.md');
}

/**
 * Parse a marketplace.json file
 */
export async function parseMarketplaceFile(filePath: string): Promise<any> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error: any) {
    throw new Error(`Failed to parse marketplace file ${filePath}: ${error.message}`);
  }
}
