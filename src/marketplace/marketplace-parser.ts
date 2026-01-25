/**
 * Marketplace parser - parses marketplace.json files
 */

import { readFile } from 'fs/promises';
import { resolve, dirname, join } from 'path';
import type { Marketplace, MarketplaceEntry, AddonSource } from './marketplace-types.js';

/**
 * Parse a marketplace.json file
 */
export async function parseMarketplace(marketplacePath: string): Promise<Marketplace> {
  try {
    const absolutePath = resolve(marketplacePath);
    const content = await readFile(absolutePath, 'utf-8');
    const data = JSON.parse(content);

    const marketplace: Marketplace = {
      name: data.name || 'unnamed-marketplace',
      owner: data.owner,
      metadata: data.metadata,
      sourceRepo: data.freedom?.sourceRepo,
      plugins: data.plugins || [],
      path: absolutePath,
    };

    return marketplace;
  } catch (error: any) {
    throw new Error(`Failed to parse marketplace ${marketplacePath}: ${error.message}`);
  }
}

/**
 * Resolve the type and location of an addon source
 */
export function resolveSourceType(
  source: string | AddonSource,
  marketplaceDir?: string,
  marketplaceRepo?: { url: string; branch?: string }
): {
  type: 'local' | 'git';
  location: string;
  branch?: string;
  tag?: string;
  subdir?: string;
} {
  // If source is a string, determine if it's a git URL or local path
  if (typeof source === 'string') {
    // Check if it looks like a git URL
    if (
      source.startsWith('http://') ||
      source.startsWith('https://') ||
      source.startsWith('git@') ||
      source.includes('github.com') ||
      source.includes('gitlab.com')
    ) {
      return {
        type: 'git',
        location: source,
      };
    }

    const isAbsolutePath =
      source.startsWith('/') || /^[A-Za-z]:[\\/]/.test(source);

    if (marketplaceRepo && !isAbsolutePath) {
      return {
        type: 'git',
        location: marketplaceRepo.url,
        branch: marketplaceRepo.branch,
        subdir: source,
      };
    }

    {
      // It's a local path - resolve relative to marketplace directory
      const location = marketplaceDir ? join(marketplaceDir, source) : source;
      return {
        type: 'local',
        location: resolve(location),
      };
    }
  }

  // Source is an AddonSource object
  if (source.source === 'url' && source.url) {
    return {
      type: 'git',
      location: source.url,
      branch: source.branch,
      tag: source.tag,
    };
  } else if (source.source === 'local' && source.path) {
    const location = marketplaceDir ? join(marketplaceDir, source.path) : source.path;
    return {
      type: 'local',
      location: resolve(location),
    };
  }

  throw new Error('Invalid addon source specification');
}

/**
 * Get all entries from a marketplace
 */
export function getMarketplaceEntries(marketplace: Marketplace): MarketplaceEntry[] {
  return marketplace.plugins || [];
}

/**
 * Find an entry by name in a marketplace
 */
export function findEntryByName(
  marketplace: Marketplace,
  name: string
): MarketplaceEntry | undefined {
  return marketplace.plugins.find(
    (entry) => entry.name.toLowerCase() === name.toLowerCase()
  );
}

/**
 * Search marketplace entries by query
 */
export function searchMarketplace(
  marketplace: Marketplace,
  query: string
): MarketplaceEntry[] {
  const lowerQuery = query.toLowerCase();
  return marketplace.plugins.filter((entry) => {
    const nameMatch = entry.name.toLowerCase().includes(lowerQuery);
    const descMatch = entry.description?.toLowerCase().includes(lowerQuery);
    const categoryMatch = entry.category?.toLowerCase().includes(lowerQuery);
    return nameMatch || descMatch || categoryMatch;
  });
}

/**
 * Get marketplace directory (parent of marketplace.json)
 */
export function getMarketplaceDirectory(marketplacePath: string): string {
  return dirname(resolve(marketplacePath));
}
