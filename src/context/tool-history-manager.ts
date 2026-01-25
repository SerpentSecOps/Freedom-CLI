/**
 * Tool History Manager
 * Handles offloading 'stale' tool outputs (and inputs) to storage and retrieving them on demand.
 * Implementation of the "Semantic Tool Compression" strategy.
 */

import { randomUUID } from 'crypto';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.js';
import { getConfig } from '../config.js';

interface ArchivedContent {
  id: string;
  type: 'output' | 'input';
  toolName: string;
  data: string; // The full content
  summary: string;
  timestamp: number;
}

// Global storage for the session
const archive = new Map<string, ArchivedContent>();

export class ToolHistoryManager {
  /**
   * Archive tool content (input or output) and return a summary string
   */
  static archiveContent(
    type: 'output' | 'input',
    toolName: string,
    data: string,
    extraInfo?: string
  ): string {
    const id = randomUUID().substring(0, 8);
    const size = data.length;
    const lines = data.split('\n').length;
    
    let summary = '';
    let marker = '';

    archive.set(id, {
      id,
      type,
      toolName,
      data,
      summary: type === 'output' ? (extraInfo || `Executed ${toolName}`) : `Input for ${toolName}`,
      timestamp: Date.now()
    });

    if (type === 'output') {
      summary = extraInfo || `Executed ${toolName} (${size} chars)`;
      return `[Output archived. Action: ${summary}. ID: ${id}. Use tool 'recall' to view.]`;
    } else {
      // Input retention strategy: Head + Tail
      const config = getConfig();
      const HEAD_SIZE = config.historyInputHeadCharacters || 200;
      const TAIL_SIZE = config.historyInputTailCharacters || 100;

      if (size <= (HEAD_SIZE + TAIL_SIZE + 50)) {
        // Too small to be worth splitting, just fully archive if we got here
        summary = `Input for ${toolName} (${size} chars, ${lines} lines)`;
        return `[Input archived. Action: ${summary}. ID: ${id}. File written/modified.]`;
      }

      const head = data.substring(0, HEAD_SIZE);
      const tail = data.substring(size - TAIL_SIZE);
      const hiddenChars = size - HEAD_SIZE - TAIL_SIZE;
      
      return `${head}\n... [Content archived. ${hiddenChars} chars hidden. ID: ${id}] ...\n${tail}`;
    }
  }

  /**
   * Retrieve content by ID
   */
  static retrieveOutput(id: string): string | null {
    const entry = archive.get(id);
    return entry ? entry.data : null;
  }

  /**
   * Process message history to archive stale tool outputs AND inputs.
   */
  static processHistory(
    messages: MessageParam[], 
    keepInputTurns: number = 2,
    keepOutputTurns: number = 2
  ): boolean {
    const config = getConfig();
    let userMsgCount = 0;
    let modified = false;

    // Iterate backwards
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      
      if (msg.role === 'user') {
        userMsgCount++;
      }

      // Check if we are deeper than thresholds
      const isOldInput = userMsgCount > keepInputTurns;
      const isOldOutput = userMsgCount > keepOutputTurns;

      // 1. Handle Tool OUTPUTS (in user messages)
      if (isOldOutput && msg.role === 'user' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (
            (block as any).type === 'tool_result' && 
            typeof (block as any).content === 'string'
          ) {
            const toolResult = block as any;
            const content = toolResult.content;

            if (!content.startsWith('[Output archived.') && !content.startsWith('[Input archived.') && !content.includes('[Content archived.')) {
              const toolName = this.findToolNameForId(messages, i, toolResult.tool_use_id) || 'unknown_tool';
              const toolInput = this.findToolInputForId(messages, i, toolResult.tool_use_id) || {};
              const summary = this.generateSummary(toolName, toolInput, content);
              
              toolResult.content = this.archiveContent('output', toolName, content, summary);
              modified = true;
            }
          }
        }
      }

      // 2. Handle Tool INPUTS (in assistant messages)
      if (isOldInput && msg.role === 'assistant' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if ((block as any).type === 'tool_use') {
            const toolUse = block as any;
            const input = toolUse.input || {};

            // Check for large content fields to archive
            const fieldsToArchive = ['content', 'new_string', 'new_content'];
            const MIN_ARCHIVE_SIZE = config.historyArchiveLimit || 500;

            for (const field of fieldsToArchive) {
              if (
                typeof input[field] === 'string' && 
                input[field].length > MIN_ARCHIVE_SIZE &&
                !input[field].includes('[Content archived.') &&
                !input[field].startsWith('[Input archived.')
              ) {
                const originalContent = input[field];
                input[field] = this.archiveContent('input', toolUse.name, originalContent);
                modified = true;
              }
            }
          }
        }
      }
    }

    return modified;
  }

  /**
   * Generate a deterministic summary based on tool type (for outputs)
   */
  private static generateSummary(
    toolName: string, 
    input: Record<string, unknown>, 
    output: string
  ): string {
    const size = output.length;
    const lines = output.split('\n').length;

    switch (toolName) {
      case 'read_file':
      case 'read':
        return `Read ${input.path || 'file'} (${size} chars, ${lines} lines)`;
      
      case 'ls':
      case 'list_directory':
        return `Listed ${input.path || 'directory'} (${lines} items)`;
      
      case 'search_file_content':
      case 'grep':
        return `Searched for "${input.pattern}" (${lines} matches)`;
        
      case 'run_shell_command':
        return `Ran command "${input.command}"`;
        
      default:
        return `Executed ${toolName} (${size} chars output)`;
    }
  }

  /**
   * Helper to find tool name by ID in previous messages
   */
  private static findToolNameForId(messages: MessageParam[], currentIndex: number, toolUseId: string): string | null {
    // Look backwards from current index for the assistant message containing the tool_use
    for (let i = currentIndex - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if ((block as any).type === 'tool_use' && (block as any).id === toolUseId) {
            return (block as any).name;
          }
        }
      }
    }
    return null;
  }

  private static findToolInputForId(messages: MessageParam[], currentIndex: number, toolUseId: string): Record<string, unknown> | null {
    for (let i = currentIndex - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if ((block as any).type === 'tool_use' && (block as any).id === toolUseId) {
            return (block as any).input;
          }
        }
      }
    }
    return null;
  }
}
