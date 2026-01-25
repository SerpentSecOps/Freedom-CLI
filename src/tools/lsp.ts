/**
 * LSP Tool - allows Claude to query language servers
 */

import type { Tool, ToolExecutionContext, ToolExecutionResult } from '../types.js';
import { lspManager } from '../lsp/lsp-manager.js';
import { resolve } from 'path';

export const lspTool: Tool = {
  definition: {
    name: 'LSP',
    description: 'Query language server for code intelligence (definitions, references, types, hover information, symbols). Use this to understand code structure, find where functions/classes are defined, get type information, or locate all references to a symbol.',
    input_schema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: [
            'goToDefinition',
            'findReferences',
            'hover',
            'documentSymbol',
            'workspaceSymbol',
            'completion',
          ],
          description: 'The LSP operation to perform',
        },
        filePath: {
          type: 'string',
          description: 'Absolute path to the file',
        },
        line: {
          type: 'number',
          description: 'Line number (0-based)',
        },
        character: {
          type: 'number',
          description: 'Character offset in the line (0-based)',
        },
        query: {
          type: 'string',
          description: 'Search query (only for workspaceSymbol operation)',
        },
      },
      required: ['operation', 'filePath'],
    },
  },

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const operation = input.operation as string;
    const filePath = resolve(input.filePath as string);
    const line = (input.line as number) || 0;
    const character = (input.character as number) || 0;
    const query = input.query as string;

    try {
      // Get LSP client for this file
      const client = lspManager.getClientForFile(filePath);

      if (!client) {
        return {
          success: false,
          error: `No LSP server configured for file type: ${filePath}`,
        };
      }

      if (!client.isReady()) {
        return {
          success: false,
          error: 'LSP server is not ready. Please wait for it to initialize.',
        };
      }

      // Execute operation
      let result;

      switch (operation) {
        case 'goToDefinition':
          result = await client.goToDefinition(filePath, line, character);
          break;

        case 'findReferences':
          result = await client.findReferences(filePath, line, character);
          break;

        case 'hover':
          result = await client.hover(filePath, line, character);
          break;

        case 'documentSymbol':
          result = await client.documentSymbol(filePath);
          break;

        case 'workspaceSymbol':
          if (!query) {
            return {
              success: false,
              error: 'workspaceSymbol operation requires a query parameter',
            };
          }
          result = await client.workspaceSymbol(query);
          break;

        case 'completion':
          result = await client.completion(filePath, line, character);
          break;

        default:
          return {
            success: false,
            error: `Unknown LSP operation: ${operation}`,
          };
      }

      if (!result.success) {
        return {
          success: false,
          error: result.error,
        };
      }

      // Format result for Claude
      const formattedResult = formatLSPResult(operation, result.result);

      return {
        success: true,
        output: formattedResult,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `LSP operation failed: ${error.message}`,
      };
    }
  },
};

/**
 * Format LSP result for human-readable output
 */
function formatLSPResult(operation: string, result: any): string {
  if (!result) {
    return 'No results found.';
  }

  switch (operation) {
    case 'goToDefinition':
    case 'findReferences':
      if (!Array.isArray(result) || result.length === 0) {
        return 'No locations found.';
      }
      return formatLocations(result);

    case 'hover':
      return formatHover(result);

    case 'documentSymbol':
    case 'workspaceSymbol':
      if (!Array.isArray(result) || result.length === 0) {
        return 'No symbols found.';
      }
      return formatSymbols(result);

    case 'completion':
      if (!Array.isArray(result) || result.length === 0) {
        return 'No completions found.';
      }
      return formatCompletions(result);

    default:
      return JSON.stringify(result, null, 2);
  }
}

/**
 * Format locations
 */
function formatLocations(locations: any[]): string {
  const lines: string[] = [`Found ${locations.length} location(s):\n`];

  for (const loc of locations) {
    const uri = loc.uri || '';
    const range = loc.range || {};
    const start = range.start || { line: 0, character: 0 };

    // Convert file:// URI to path
    const path = uri.replace(/^file:\/\//, '');

    lines.push(`  ${path}:${start.line + 1}:${start.character + 1}`);
  }

  return lines.join('\n');
}

/**
 * Format hover information
 */
function formatHover(hover: any): string {
  if (!hover || !hover.contents) {
    return 'No hover information available.';
  }

  const contents = Array.isArray(hover.contents)
    ? hover.contents
    : [hover.contents];

  const lines: string[] = ['Hover Information:\n'];

  for (const content of contents) {
    if (typeof content === 'string') {
      lines.push(content);
    } else if (content.value) {
      lines.push(content.value);
    }
  }

  return lines.join('\n');
}

/**
 * Format symbols
 */
function formatSymbols(symbols: any[]): string {
  const lines: string[] = [`Found ${symbols.length} symbol(s):\n`];

  for (const symbol of symbols) {
    const name = symbol.name || 'unnamed';
    const kind = getSymbolKindName(symbol.kind);
    const location = symbol.location || {};
    const uri = location.uri || '';
    const range = location.range || {};
    const start = range.start || { line: 0, character: 0 };

    // Convert file:// URI to path
    const path = uri.replace(/^file:\/\//, '');

    lines.push(`  ${kind}: ${name}`);
    if (path) {
      lines.push(`    at ${path}:${start.line + 1}:${start.character + 1}`);
    }

    if (symbol.containerName) {
      lines.push(`    in ${symbol.containerName}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format completions
 */
function formatCompletions(completions: any[]): string {
  const lines: string[] = [`Found ${completions.length} completion(s):\n`];

  const limited = completions.slice(0, 20); // Limit to 20 for readability

  for (const item of limited) {
    const label = item.label || '';
    const kind = getCompletionKindName(item.kind);
    const detail = item.detail || '';

    lines.push(`  ${label} (${kind})`);
    if (detail) {
      lines.push(`    ${detail}`);
    }
  }

  if (completions.length > 20) {
    lines.push(`\n... and ${completions.length - 20} more`);
  }

  return lines.join('\n');
}

/**
 * Get symbol kind name
 */
function getSymbolKindName(kind: number): string {
  const kinds: Record<number, string> = {
    1: 'File',
    2: 'Module',
    3: 'Namespace',
    4: 'Package',
    5: 'Class',
    6: 'Method',
    7: 'Property',
    8: 'Field',
    9: 'Constructor',
    10: 'Enum',
    11: 'Interface',
    12: 'Function',
    13: 'Variable',
    14: 'Constant',
    15: 'String',
    16: 'Number',
    17: 'Boolean',
    18: 'Array',
  };
  return kinds[kind] || 'Unknown';
}

/**
 * Get completion kind name
 */
function getCompletionKindName(kind: number): string {
  const kinds: Record<number, string> = {
    1: 'Text',
    2: 'Method',
    3: 'Function',
    4: 'Constructor',
    5: 'Field',
    6: 'Variable',
    7: 'Class',
    8: 'Interface',
    9: 'Module',
    10: 'Property',
    11: 'Unit',
    12: 'Value',
    13: 'Enum',
    14: 'Keyword',
    15: 'Snippet',
    16: 'Color',
    17: 'File',
    18: 'Reference',
  };
  return kinds[kind] || 'Unknown';
}
