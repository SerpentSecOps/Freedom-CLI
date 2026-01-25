/**
 * Type definitions for Claude Code skills compatibility
 */

/**
 * Metadata from YAML frontmatter in SKILL.md files
 */
export interface SkillMetadata {
  /** Unique name of the skill */
  name: string;
  /** Description of when to use this skill */
  description: string;
  /** Optional license information */
  license?: string;
  /** File path where skill was loaded from */
  path: string;
}

/**
 * A fully loaded skill with content and metadata
 */
export interface LoadedSkill {
  /** Parsed metadata from frontmatter */
  metadata: SkillMetadata;
  /** Main skill instructions (body after frontmatter) */
  content: string;
  /** Paths to additional reference files (forms.md, reference.md, etc.) */
  referencePaths: string[];
  /** Whether the skill is currently active */
  active: boolean;
}

/**
 * Configuration for skill system from config.json
 */
export interface SkillsConfig {
  /** Whether skills are enabled */
  enabled: boolean;
  /** Automatically load skills on startup */
  autoLoad: boolean;
  /** Directories to scan for skills */
  paths: string[];
  /** Marketplace.json files to load skills from */
  marketplaces: string[];
}

/**
 * Entry for a skill in a marketplace.json file
 */
export interface SkillMarketplaceEntry {
  /** Skill name */
  name: string;
  /** Description of the skill */
  description: string;
  /** Path to the skill directory (relative to marketplace.json) */
  source: string;
  /** Optional category */
  category?: string;
  /** Optional homepage URL */
  homepage?: string;
  /** Optional version */
  version?: string;
}

/**
 * Collection of skills in a marketplace.json file
 */
export interface SkillMarketplace {
  /** Marketplace name */
  name: string;
  /** Marketplace owner info */
  owner?: {
    name: string;
    email: string;
  };
  /** Marketplace metadata */
  metadata?: {
    description?: string;
    version?: string;
  };
  /** List of skill plugins */
  plugins: Array<{
    name: string;
    description: string;
    source: string;
    strict?: boolean;
    skills: string[];  // Array of skill paths
  }>;
}
