/**
 * Quarantine system for protecting directories from LLM access
 */

import { resolve, normalize } from 'path';
import { getConfig } from './config.js';

/**
 * Check if a path is quarantined (blocked from access)
 */
export function isPathQuarantined(targetPath: string): boolean {
  const config = getConfig();
  const quarantinedPaths = config.quarantinedPaths || [];

  if (quarantinedPaths.length === 0) {
    return false;
  }

  // Normalize and resolve the target path
  const normalizedTarget = normalize(resolve(targetPath));

  // Check if the target path is within any quarantined directory
  for (const quarantinedPath of quarantinedPaths) {
    const normalizedQuarantine = normalize(resolve(quarantinedPath));

    // Check if target is exactly the quarantined path or within it
    if (normalizedTarget === normalizedQuarantine ||
        normalizedTarget.startsWith(normalizedQuarantine + '/') ||
        normalizedTarget.startsWith(normalizedQuarantine + '\\')) {
      return true;
    }
  }

  return false;
}

/**
 * Validate that a path is not quarantined, throwing an error if it is
 */
export function validatePathNotQuarantined(targetPath: string): void {
  if (isPathQuarantined(targetPath)) {
    throw new Error(`Access denied: Path "${targetPath}" is quarantined and cannot be accessed`);
  }
}

/**
 * Check if a path is contained within a root directory (no escape via ../)
 */
export function isPathContained(targetPath: string, rootDir: string): boolean {
  const normalizedTarget = normalize(resolve(rootDir, targetPath));
  const normalizedRoot = normalize(resolve(rootDir));

  // Target must start with root directory path
  return normalizedTarget === normalizedRoot ||
         normalizedTarget.startsWith(normalizedRoot + '/') ||
         normalizedTarget.startsWith(normalizedRoot + '\\');
}

/**
 * Validate that a path stays within the working directory, throwing an error if it escapes
 */
export function validatePathContained(targetPath: string, workingDirectory: string): void {
  if (!isPathContained(targetPath, workingDirectory)) {
    const resolvedPath = normalize(resolve(workingDirectory, targetPath));
    throw new Error(`Access denied: Path "${resolvedPath}" is outside the working directory "${workingDirectory}"`);
  }
}

/**
 * Resolve a path safely within the working directory
 * Returns the resolved path if contained, throws if it escapes
 */
export function resolveSafePath(inputPath: string, workingDirectory: string): string {
  // Strip leading slashes to prevent absolute paths
  const safePath = inputPath.replace(/^\/+/, '');
  const resolvedPath = resolve(workingDirectory, safePath);

  // Verify containment
  validatePathContained(safePath, workingDirectory);

  return resolvedPath;
}
