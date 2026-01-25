/**
 * Toolkit types - Type definitions for the toolkit system
 *
 * Toolkits are collections of CLI tools that the LLM can use via Bash.
 * They're stored in ~/.freedom-cli/toolkits/ and the LLM reads their
 * documentation on-demand to learn how to use them.
 */

/**
 * Represents an installed toolkit
 */
export interface InstalledToolkit {
  /** Toolkit name (used as folder name, spaces converted to dashes) */
  name: string;

  /** Path to the toolkit directory in ~/.freedom-cli/toolkits/ */
  path: string;

  /** Original source path (where it was copied from) */
  sourcePath: string;

  /** When the toolkit was installed */
  installedAt: number;

  /** When the toolkit was last updated */
  updatedAt?: number;

  /** Optional description from manifest */
  description?: string;
}

/**
 * Result of a toolkit operation
 */
export interface ToolkitOperationResult {
  success: boolean;
  message?: string;
  error?: string;
  path?: string;
  name?: string;
}

/**
 * Toolkit manifest (optional toolkit.json in the toolkit folder)
 */
export interface ToolkitManifest {
  /** Display name for the toolkit */
  name?: string;

  /** Description of what the toolkit does */
  description?: string;

  /** Version string */
  version?: string;

  /** Author information */
  author?: string;

  /** List of tool names in this toolkit */
  tools?: string[];

  /** Path to documentation directory (default: tool_docs/) */
  docsDir?: string;
}
