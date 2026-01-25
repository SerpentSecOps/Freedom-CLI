/**
 * Web Search tool - Search the web using DuckDuckGo
 * No API key required - uses DuckDuckGo HTML search
 */

import type { Tool, ToolExecutionContext, ToolExecutionResult } from '../types.js';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Parse DuckDuckGo HTML search results
 */
function parseSearchResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  // DuckDuckGo HTML results are in <a class="result__a"> tags
  // with snippets in <a class="result__snippet"> tags

  // Match result blocks - DuckDuckGo lite uses simpler HTML
  const resultRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
  const snippetRegex = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/a>/gi;

  // Try to extract results using different patterns
  // Pattern 1: Look for result links with uddg parameter (DuckDuckGo redirect URLs)
  const uddgPattern = /href="[^"]*uddg=([^&"]+)[^"]*"[^>]*>([^<]+)<\/a>/gi;
  let match;

  while ((match = uddgPattern.exec(html)) !== null) {
    try {
      const url = decodeURIComponent(match[1]);
      const title = match[2].trim();
      if (url && title && !url.includes('duckduckgo.com')) {
        results.push({ title, url, snippet: '' });
      }
    } catch {
      // Skip invalid URLs
    }
  }

  // Pattern 2: Look for web-result divs (newer format)
  const webResultPattern = /<div[^>]*class="[^"]*web-result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  while ((match = webResultPattern.exec(html)) !== null) {
    const block = match[1];
    const linkMatch = /href="([^"]+)"[^>]*>([^<]+)</i.exec(block);
    if (linkMatch) {
      const url = linkMatch[1];
      const title = linkMatch[2].trim();
      if (url && title && !url.includes('duckduckgo.com') && !results.some(r => r.url === url)) {
        results.push({ title, url, snippet: '' });
      }
    }
  }

  // Pattern 3: Generic link extraction as fallback
  if (results.length === 0) {
    const linkPattern = /<a[^>]*href="(https?:\/\/(?!duckduckgo)[^"]+)"[^>]*>([^<]+)<\/a>/gi;
    while ((match = linkPattern.exec(html)) !== null && results.length < 20) {
      const url = match[1];
      const title = match[2].trim();
      // Filter out navigation and irrelevant links
      if (url && title && title.length > 5 && !url.includes('duckduckgo.com')) {
        if (!results.some(r => r.url === url)) {
          results.push({ title, url, snippet: '' });
        }
      }
    }
  }

  // Try to extract snippets and associate with results
  const snippetMatches = html.matchAll(/<[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/gi);
  let idx = 0;
  for (const snippetMatch of snippetMatches) {
    if (idx < results.length) {
      // Clean HTML tags from snippet
      results[idx].snippet = snippetMatch[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
      idx++;
    }
  }

  return results;
}

/**
 * Fetch search results from DuckDuckGo HTML
 */
async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
  // Use DuckDuckGo HTML version (no JavaScript required)
  const encodedQuery = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
  });

  if (!response.ok) {
    throw new Error(`Search request failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const results = parseSearchResults(html);

  return results.slice(0, maxResults);
}

export const webSearchTool: Tool = {
  definition: {
    name: 'web_search',
    description: 'Search the web for current information using DuckDuckGo. Use this tool to find up-to-date information about events, products, news, documentation, or any topic requiring current information beyond your knowledge cutoff. Returns search results with titles, URLs, and snippets.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (e.g., "latest Node.js version", "React hooks tutorial", "weather API documentation")',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to return (default: 10, max: 20)',
        },
      },
      required: ['query'],
    },
  },

  async execute(input: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const query = input.query as string;
    const maxResults = Math.min(Math.max((input.max_results as number) || 10, 1), 20);

    try {
      // Validate query
      if (!query || query.trim().length === 0) {
        return {
          success: false,
          error: 'Search query cannot be empty',
        };
      }

      if (query.trim().length < 2) {
        return {
          success: false,
          error: 'Search query must be at least 2 characters',
        };
      }

      // Perform search
      const results = await searchDuckDuckGo(query.trim(), maxResults);

      if (results.length === 0) {
        return {
          success: true,
          output: `No search results found for: "${query}"\n\nTry:\n- Using different keywords\n- Checking spelling\n- Using more general terms`,
        };
      }

      // Format output
      let output = `Found ${results.length} result${results.length === 1 ? '' : 's'} for "${query}":\n\n`;

      results.forEach((result, idx) => {
        output += `${idx + 1}. ${result.title}\n`;
        output += `   URL: ${result.url}\n`;
        if (result.snippet) {
          output += `   ${result.snippet}\n`;
        }
        output += '\n';
      });

      return {
        success: true,
        output: output.trim(),
        metadata: {
          query,
          resultCount: results.length,
        },
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Web search failed: ${errorMessage}`,
      };
    }
  },

  // Web search is read-only, no confirmation needed
  shouldConfirm(): boolean {
    return false;
  },
};
