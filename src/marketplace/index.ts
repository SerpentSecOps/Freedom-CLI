/**
 * Marketplace system - addon installation and management
 * Exports all marketplace functionality
 */

export { MarketplaceManager, marketplaceManager } from './marketplace-manager.js';
export { GitInstaller, gitInstaller } from './git-installer.js';
export {
  parseMarketplace,
  resolveSourceType,
  findEntryByName,
  searchMarketplace,
  getMarketplaceDirectory,
} from './marketplace-parser.js';
export type {
  AddonSource,
  MarketplaceEntry,
  LSPServerConfig,
  Marketplace,
  InstalledAddon,
  GitOperationResult,
  AddonInstallResult,
} from './marketplace-types.js';

import { marketplaceManager } from './marketplace-manager.js';

/**
 * Initialize marketplaces from config
 */
export async function initializeMarketplaces(marketplacePaths: string[]): Promise<void> {
  if (!marketplacePaths || marketplacePaths.length === 0) {
    return;
  }

  let loadedCount = 0;
  let errorCount = 0;

  for (const marketplacePath of marketplacePaths) {
    try {
      await marketplaceManager.addMarketplace(marketplacePath);
      loadedCount++;
    } catch (error: any) {
      console.error(`Warning: Failed to load marketplace ${marketplacePath}: ${error.message}`);
      errorCount++;
    }
  }

  if (loadedCount > 0) {
    console.log(`✓ Loaded ${loadedCount} marketplace(s)`);
    if (errorCount > 0) {
      console.log(`⚠ ${errorCount} marketplace(s) failed to load`);
    }
  }
}
