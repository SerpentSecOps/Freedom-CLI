/**
 * Type definitions for marketplace and git installation
 */

/**
 * Source specification for an addon (local or git)
 */
export interface AddonSource {
  source: 'local' | 'url';
  url?: string;      // Git URL
  path?: string;     // Local filesystem path
  branch?: string;   // Git branch (default: main)
  tag?: string;      // Git tag
}

/**
 * Marketplace entry for a plugin or skill collection
 */
export interface MarketplaceEntry {
  /** Entry name */
  name: string;
  /** Entry description */
  description: string;
  /** Source (can be string path or AddonSource object) */
  source: string | AddonSource;
  /** Optional category */
  category?: string;
  /** Optional homepage */
  homepage?: string;
  /** Optional version */
  version?: string;
  /** Strict mode */
  strict?: boolean;
  /** LSP servers configuration */
  lspServers?: Record<string, LSPServerConfig>;
  /** Array of skill paths (for skill collections) */
  skills?: string[];
  /** Array of agent paths (for plugin with agents) */
  agents?: string[];
}

/**
 * LSP Server configuration from marketplace
 */
export interface LSPServerConfig {
  /** Command to start the LSP server */
  command: string;
  /** Command arguments */
  args?: string[];
  /** Extension to language mapping */
  extensionToLanguage?: Record<string, string>;
  /** Startup timeout in milliseconds */
  startupTimeout?: number;
  /** Environment variables */
  env?: Record<string, string>;
  /** Working directory for LSP server process */
  cwd?: string;
}

/**
 * Complete marketplace structure
 */
export interface Marketplace {
  /** Marketplace name */
  name: string;
  /** Owner information */
  owner?: {
    name: string;
    email: string;
  };
  /** Metadata */
  metadata?: {
    description?: string;
    version?: string;
  };
  /** Source repository info for relative plugin paths */
  sourceRepo?: {
    url: string;
    branch?: string;
  };
  /** List of plugins */
  plugins: MarketplaceEntry[];
  /** Path to marketplace.json file */
  path?: string;
}

/**
 * Installed addon metadata
 */
export interface InstalledAddon {
  /** Addon name */
  name: string;
  /** Installation type */
  type: 'git' | 'local';
  /** Installation path */
  path: string;
  /** Repository root for git addons with subdir installs */
  repoRoot?: string;
  /** Subdirectory within the repo */
  subdir?: string;
  /** Source URL (for git addons) */
  sourceUrl?: string;
  /** Branch/tag (for git addons) */
  branch?: string;
  /** Installation timestamp */
  installedAt: number;
  /** Last update timestamp */
  updatedAt?: number;
  /** Marketplace it came from (if any) */
  marketplace?: string;
}

/**
 * Git clone/update result
 */
export interface GitOperationResult {
  success: boolean;
  path?: string;
  error?: string;
  message?: string;
}

/**
 * Addon installation result
 */
export interface AddonInstallResult {
  success: boolean;
  name: string;
  path?: string;
  type?: 'skill' | 'plugin';
  error?: string;
  message?: string;
}
