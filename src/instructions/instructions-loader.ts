/**
 * Instructions Loader - Loads instruction files from various sources
 * Supports:
 * - GitHub Copilot CLI: copilot-instructions.md, *.instructions.md
 * - Custom instruction files from configured paths
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/**
 * Loaded instruction file
 */
export interface LoadedInstruction {
  /** Instruction content (markdown) */
  content: string;
  /** Source file path */
  sourcePath: string;
  /** Source type */
  sourceType: 'copilot-project' | 'copilot-user' | 'github' | 'custom';
  /** File name without extension */
  name: string;
}

/**
 * Instructions configuration
 */
export interface InstructionsConfig {
  /** Whether instructions loading is enabled */
  enabled: boolean;
  /** Additional paths to search */
  paths: string[];
  /** Files to exclude */
  exclude: string[];
}

// Standard instruction file locations (Copilot CLI compatible)
const INSTRUCTION_PATHS = {
  // Project-level (in repo)
  project: [
    '.github/copilot-instructions.md',
    '.github/instructions',              // Directory of *.instructions.md files
    '.copilot/copilot-instructions.md',
    'copilot-instructions.md',           // Root level
  ],
  // User-level (global)
  user: [
    '~/.copilot/copilot-instructions.md',
    '~/.config/copilot/instructions.md',
  ],
};

/**
 * Expand ~ to home directory
 */
function expandPath(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * Check if a path exists
 */
async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if path is a directory
 */
async function isDirectory(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Find all *.instructions.md files in a directory
 */
async function findInstructionFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  
  if (!await pathExists(dir)) {
    return results;
  }

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.instructions.md')) {
        results.push(path.join(dir, entry.name));
      }
    }
  } catch (error) {
    // Silently ignore permission errors
  }

  return results;
}

/**
 * Load a single instruction file
 */
async function loadInstructionFile(
  filePath: string, 
  sourceType: LoadedInstruction['sourceType']
): Promise<LoadedInstruction | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const name = path.basename(filePath, '.md')
      .replace('.instructions', '')
      .replace('copilot-instructions', 'copilot');

    return {
      content: content.trim(),
      sourcePath: filePath,
      sourceType,
      name,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Instructions Loader class
 */
export class InstructionsLoader {
  private instructions: LoadedInstruction[] = [];
  private config: InstructionsConfig;
  private workingDirectory: string;

  constructor(workingDirectory: string, config?: Partial<InstructionsConfig>) {
    this.workingDirectory = workingDirectory;
    this.config = {
      enabled: true,
      paths: [],
      exclude: [],
      ...config,
    };
  }

  /**
   * Discover and load all instruction files
   */
  async discoverInstructions(): Promise<LoadedInstruction[]> {
    if (!this.config.enabled) {
      return [];
    }

    this.instructions = [];

    // Load project-level instructions
    for (const relativePath of INSTRUCTION_PATHS.project) {
      const fullPath = path.join(this.workingDirectory, relativePath);
      const expanded = expandPath(fullPath);

      if (await isDirectory(expanded)) {
        // It's a directory, find all *.instructions.md files
        const files = await findInstructionFiles(expanded);
        for (const file of files) {
          if (!this.isExcluded(file)) {
            const instruction = await loadInstructionFile(file, 'github');
            if (instruction) {
              this.instructions.push(instruction);
            }
          }
        }
      } else if (await pathExists(expanded)) {
        // It's a file
        if (!this.isExcluded(expanded)) {
          const instruction = await loadInstructionFile(expanded, 'copilot-project');
          if (instruction) {
            this.instructions.push(instruction);
          }
        }
      }
    }

    // Load user-level instructions
    for (const userPath of INSTRUCTION_PATHS.user) {
      const expanded = expandPath(userPath);
      
      if (await pathExists(expanded) && !this.isExcluded(expanded)) {
        const instruction = await loadInstructionFile(expanded, 'copilot-user');
        if (instruction) {
          this.instructions.push(instruction);
        }
      }
    }

    // Load from custom paths
    for (const customPath of this.config.paths) {
      const expanded = expandPath(customPath);
      
      if (await isDirectory(expanded)) {
        const files = await findInstructionFiles(expanded);
        for (const file of files) {
          if (!this.isExcluded(file)) {
            const instruction = await loadInstructionFile(file, 'custom');
            if (instruction) {
              this.instructions.push(instruction);
            }
          }
        }
      } else if (await pathExists(expanded) && !this.isExcluded(expanded)) {
        const instruction = await loadInstructionFile(expanded, 'custom');
        if (instruction) {
          this.instructions.push(instruction);
        }
      }
    }

    return this.instructions;
  }

  /**
   * Check if a file should be excluded
   */
  private isExcluded(filePath: string): boolean {
    return this.config.exclude.some(pattern => {
      if (pattern.includes('*')) {
        // Simple glob matching
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(path.basename(filePath));
      }
      return filePath.includes(pattern);
    });
  }

  /**
   * Get all loaded instructions
   */
  getAllInstructions(): LoadedInstruction[] {
    return this.instructions;
  }

  /**
   * Get combined instruction content for injection into system prompt
   */
  getCombinedContent(): string {
    if (this.instructions.length === 0) {
      return '';
    }

    const sections: string[] = [];

    // Group by source type
    const byType = new Map<string, LoadedInstruction[]>();
    for (const instr of this.instructions) {
      const existing = byType.get(instr.sourceType) || [];
      existing.push(instr);
      byType.set(instr.sourceType, existing);
    }

    // User instructions first (most general)
    const userInstructions = byType.get('copilot-user') || [];
    if (userInstructions.length > 0) {
      sections.push('## User Instructions\n');
      sections.push(...userInstructions.map(i => i.content));
    }

    // Project instructions (more specific)
    const projectInstructions = [
      ...(byType.get('copilot-project') || []),
      ...(byType.get('github') || []),
    ];
    if (projectInstructions.length > 0) {
      sections.push('\n## Project Instructions\n');
      sections.push(...projectInstructions.map(i => i.content));
    }

    // Custom instructions
    const customInstructions = byType.get('custom') || [];
    if (customInstructions.length > 0) {
      sections.push('\n## Custom Instructions\n');
      sections.push(...customInstructions.map(i => i.content));
    }

    return sections.join('\n');
  }

  /**
   * Check if any instructions are loaded
   */
  hasInstructions(): boolean {
    return this.instructions.length > 0;
  }

  /**
   * Get instruction count
   */
  getInstructionCount(): number {
    return this.instructions.length;
  }

  /**
   * List instructions for display
   */
  listInstructionsForDisplay(): string {
    if (this.instructions.length === 0) {
      return 'No instruction files loaded.';
    }

    const lines: string[] = ['Loaded Instructions:', ''];

    for (const instr of this.instructions) {
      const preview = instr.content.slice(0, 100).replace(/\n/g, ' ');
      lines.push(`  ${instr.name} (${instr.sourceType})`);
      lines.push(`    ${instr.sourcePath}`);
      lines.push(`    Preview: ${preview}${instr.content.length > 100 ? '...' : ''}`);
      lines.push('');
    }

    return lines.join('\n');
  }
}

// Export singleton factory
let loaderInstance: InstructionsLoader | null = null;

export function getInstructionsLoader(workingDirectory: string, config?: Partial<InstructionsConfig>): InstructionsLoader {
  if (!loaderInstance || loaderInstance['workingDirectory'] !== workingDirectory) {
    loaderInstance = new InstructionsLoader(workingDirectory, config);
  }
  return loaderInstance;
}

export function resetInstructionsLoader(): void {
  loaderInstance = null;
}
