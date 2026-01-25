/**
 * Agent Loader - Discovers and loads agent definitions from various sources
 * Supports:
 * - GitHub Copilot CLI: *.agent.yaml files
 * - Custom agents from configured paths
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import type { AgentDefinition, LoadedAgent, PromptTemplateVariables, AgentsConfig } from './agent-types.js';

// Default search paths for agents (Copilot CLI compatible)
const COPILOT_AGENT_PATHS = [
  '.github/agents',           // Project-level agents
  '.copilot/agents',          // Project-level copilot agents
];

const USER_AGENT_PATHS = [
  '~/.copilot/agents',        // User's global copilot agents
  '~/.config/copilot/agents', // XDG config location
];

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
 * Find all *.agent.yaml files in a directory
 */
async function findAgentFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const expandedDir = expandPath(dir);
  
  if (!await pathExists(expandedDir)) {
    return results;
  }

  try {
    const entries = await fs.readdir(expandedDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(expandedDir, entry.name);
      
      if (entry.isFile() && entry.name.endsWith('.agent.yaml')) {
        results.push(fullPath);
      } else if (entry.isDirectory()) {
        // Check subdirectories for agent files
        const subFiles = await findAgentFiles(fullPath);
        results.push(...subFiles);
      }
    }
  } catch (error) {
    // Silently ignore permission errors, etc.
  }

  return results;
}

/**
 * Parse an agent.yaml file
 */
async function parseAgentFile(filePath: string): Promise<AgentDefinition | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = yaml.parse(content);

    // Validate required fields
    if (!parsed.name || !parsed.prompt) {
      console.warn(`Agent file ${filePath} missing required fields (name, prompt)`);
      return null;
    }

    // Normalize the definition
    const definition: AgentDefinition = {
      name: parsed.name,
      displayName: parsed.displayName || parsed.name,
      description: parsed.description || '',
      model: parsed.model,
      tools: parsed.tools || null,
      promptParts: parsed.promptParts || {},
      prompt: parsed.prompt,
      mcpServers: parsed.mcpServers,
      infer: parsed.infer ?? true,
    };

    return definition;
  } catch (error: any) {
    console.warn(`Failed to parse agent file ${filePath}: ${error.message}`);
    return null;
  }
}

/**
 * Expand template variables in a prompt
 */
export function expandPromptTemplate(template: string, variables: PromptTemplateVariables): string {
  let result = template;
  
  // Replace all {{variable}} patterns
  result = result.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    const value = variables[varName as keyof PromptTemplateVariables];
    return value !== undefined ? String(value) : match;
  });

  return result;
}

/**
 * Get current template variables
 */
export function getTemplateVariables(workingDirectory: string, branch?: string): PromptTemplateVariables {
  const now = new Date();
  
  return {
    cwd: workingDirectory,
    branch: branch,
    repoName: path.basename(workingDirectory),
    date: now.toISOString().split('T')[0],
    time: now.toTimeString().split(' ')[0],
    os: os.platform(),
    user: os.userInfo().username,
  };
}

/**
 * Agent Loader class
 */
export class AgentLoader {
  private agents: Map<string, LoadedAgent> = new Map();
  private config: AgentsConfig;
  private workingDirectory: string;

  constructor(workingDirectory: string, config?: Partial<AgentsConfig>) {
    this.workingDirectory = workingDirectory;
    this.config = {
      enabled: true,
      autoDiscover: true,
      paths: [],
      disabled: [],
      ...config,
    };
  }

  /**
   * Discover and load all agents from standard paths
   */
  async discoverAgents(): Promise<LoadedAgent[]> {
    if (!this.config.enabled) {
      return [];
    }

    const agentFiles: Array<{ path: string; sourceType: 'copilot' | 'custom' }> = [];

    // Search project-level Copilot paths
    for (const relativePath of COPILOT_AGENT_PATHS) {
      const fullPath = path.join(this.workingDirectory, relativePath);
      const files = await findAgentFiles(fullPath);
      agentFiles.push(...files.map(f => ({ path: f, sourceType: 'copilot' as const })));
    }

    // Search user-level paths
    for (const userPath of USER_AGENT_PATHS) {
      const files = await findAgentFiles(userPath);
      agentFiles.push(...files.map(f => ({ path: f, sourceType: 'copilot' as const })));
    }

    // Search additional configured paths
    for (const customPath of this.config.paths) {
      const files = await findAgentFiles(customPath);
      agentFiles.push(...files.map(f => ({ path: f, sourceType: 'custom' as const })));
    }

    // Also search for agents in project root
    const rootAgents = await findAgentFiles(this.workingDirectory);
    agentFiles.push(...rootAgents.map(f => ({ path: f, sourceType: 'custom' as const })));

    // Parse all found agent files
    const loadedAgents: LoadedAgent[] = [];

    for (const { path: filePath, sourceType } of agentFiles) {
      const definition = await parseAgentFile(filePath);
      
      if (definition && !this.config.disabled.includes(definition.name)) {
        const loadedAgent: LoadedAgent = {
          definition,
          sourcePath: filePath,
          sourceType,
          active: false,
        };
        
        this.agents.set(definition.name, loadedAgent);
        loadedAgents.push(loadedAgent);
      }
    }

    return loadedAgents;
  }

  /**
   * Load a specific agent by name
   */
  getAgent(name: string): LoadedAgent | undefined {
    return this.agents.get(name);
  }

  /**
   * Get all loaded agents
   */
  getAllAgents(): LoadedAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agent by name with expanded prompt
   */
  getAgentWithExpandedPrompt(name: string, branch?: string): { agent: LoadedAgent; expandedPrompt: string } | undefined {
    const agent = this.agents.get(name);
    if (!agent) return undefined;

    const variables = getTemplateVariables(this.workingDirectory, branch);
    const expandedPrompt = expandPromptTemplate(agent.definition.prompt, variables);

    return { agent, expandedPrompt };
  }

  /**
   * Register a custom agent programmatically
   */
  registerAgent(definition: AgentDefinition, sourcePath: string = 'programmatic'): LoadedAgent {
    const loadedAgent: LoadedAgent = {
      definition,
      sourcePath,
      sourceType: 'custom',
      active: false,
    };

    this.agents.set(definition.name, loadedAgent);
    return loadedAgent;
  }

  /**
   * Check if any agents are available
   */
  hasAgents(): boolean {
    return this.agents.size > 0;
  }

  /**
   * Get agent count
   */
  getAgentCount(): number {
    return this.agents.size;
  }

  /**
   * List agents formatted for display
   */
  listAgentsForDisplay(): string {
    if (this.agents.size === 0) {
      return 'No agents loaded.';
    }

    const lines: string[] = ['Loaded Agents:', ''];
    
    for (const [name, agent] of this.agents) {
      const modelInfo = agent.definition.model ? ` (${agent.definition.model})` : '';
      const toolsInfo = agent.definition.tools 
        ? (agent.definition.tools.includes('*') ? 'all tools' : `${agent.definition.tools.length} tools`)
        : 'no tool restrictions';
      
      lines.push(`  ${agent.definition.displayName || name}${modelInfo}`);
      lines.push(`    ${agent.definition.description || 'No description'}`);
      lines.push(`    Tools: ${toolsInfo} | Source: ${agent.sourceType}`);
      lines.push('');
    }

    return lines.join('\n');
  }
}

// Export singleton factory
let loaderInstance: AgentLoader | null = null;

export function getAgentLoader(workingDirectory: string, config?: Partial<AgentsConfig>): AgentLoader {
  if (!loaderInstance || loaderInstance['workingDirectory'] !== workingDirectory) {
    loaderInstance = new AgentLoader(workingDirectory, config);
  }
  return loaderInstance;
}

export function resetAgentLoader(): void {
  loaderInstance = null;
}
