/**
 * Agent loader - loads agent definitions from plugins
 *
 * Note: For now, agents are treated as specialized skills.
 * Future implementation will add full subagent spawning support.
 */

import { readdir, stat } from 'fs/promises';
import { join, basename } from 'path';
import type { AgentDefinition } from './plugin-types.js';
import { parseAgentFile } from './plugin-parser.js';

/**
 * Agent registry - stores all loaded plugin agents
 */
export class AgentRegistry {
  private agents: Map<string, AgentDefinition> = new Map();

  /**
   * Register an agent
   */
  registerAgent(agent: AgentDefinition): void {
    this.agents.set(agent.name, agent);
  }

  /**
   * Unregister an agent
   */
  unregisterAgent(name: string): boolean {
    return this.agents.delete(name);
  }

  /**
   * Get an agent by name
   */
  getAgent(name: string): AgentDefinition | undefined {
    return this.agents.get(name);
  }

  /**
   * Get all agents
   */
  getAllAgents(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  /**
   * Match agents by query - searches in agent descriptions
   */
  matchAgentsByQuery(query: string): AgentDefinition[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.agents.values()).filter(agent => {
      const desc = agent.description.toLowerCase();
      const name = agent.name.toLowerCase();
      return desc.includes(lowerQuery) || name.includes(lowerQuery);
    });
  }

  /**
   * Clear all agents
   */
  clear(): void {
    this.agents.clear();
  }

  /**
   * Get agent names
   */
  getAgentNames(): string[] {
    return Array.from(this.agents.keys());
  }
}

/**
 * Load all agents from a plugin's agents directory
 */
export async function loadAgentsFromDirectory(
  agentsDir: string
): Promise<AgentDefinition[]> {
  const agents: AgentDefinition[] = [];

  try {
    const files = await readdir(agentsDir);

    for (const file of files) {
      // Only process .md files
      if (!file.endsWith('.md')) {
        continue;
      }

      const filePath = join(agentsDir, file);
      const fileStat = await stat(filePath);

      if (fileStat.isFile()) {
        try {
          const agent = await parseAgentFile(filePath);
          agents.push(agent);
        } catch (error: any) {
          console.error(`Failed to load agent from ${filePath}: ${error.message}`);
        }
      }
    }
  } catch (error: any) {
    throw new Error(`Failed to load agents from directory ${agentsDir}: ${error.message}`);
  }

  return agents;
}

/**
 * Convert agent definition to skill-like format
 * This allows agents to be injected as specialized skills until we implement subagents
 */
export function agentToSkillContext(agent: AgentDefinition): string {
  let context = `## Agent: ${agent.name}\n\n`;
  context += `**When to use**: ${agent.description}\n\n`;

  if (agent.tools && agent.tools.length > 0) {
    context += `**Available tools**: ${agent.tools.join(', ')}\n\n`;
  }

  if (agent.model && agent.model !== 'inherit') {
    context += `**Preferred model**: ${agent.model}\n\n`;
  }

  context += `${agent.instructions}\n`;

  return context;
}

/**
 * Global agent registry instance
 */
export const agentRegistry = new AgentRegistry();
