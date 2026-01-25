import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

interface WarningCheck {
  id: string;
  check: (workspaceRoot: string) => Promise<string | null>;
}

// Warn if running in home directory - too broad for most projects
const homeDirectoryCheck: WarningCheck = {
  id: 'home-directory',
  check: async (workspaceRoot: string) => {
    try {
      const [workspaceRealPath, homeRealPath] = await Promise.all([
        fs.realpath(workspaceRoot),
        fs.realpath(os.homedir()),
      ]);

      if (workspaceRealPath === homeRealPath) {
        return 'Warning: Running in home directory. Consider using a project-specific directory to avoid exposing personal files.';
      }
      return null;
    } catch (_err: unknown) {
      // If we can't resolve paths, skip this check silently
      return null;
    }
  },
};

// Warn if running in root directory - extremely dangerous
const rootDirectoryCheck: WarningCheck = {
  id: 'root-directory',
  check: async (workspaceRoot: string) => {
    try {
      const workspaceRealPath = await fs.realpath(workspaceRoot);

      // Check if this is a root directory (parent equals self)
      if (path.dirname(workspaceRealPath) === workspaceRealPath) {
        return 'WARNING: Running in root directory! Your entire filesystem will be accessible. Strongly recommend changing to a project directory.';
      }

      return null;
    } catch (_err: unknown) {
      // If we can't resolve paths, skip this check silently
      return null;
    }
  },
};

// Warn if .git directory exists but is ignored - user might want version control
const gitIgnoredCheck: WarningCheck = {
  id: 'git-ignored',
  check: async (workspaceRoot: string) => {
    try {
      const gitPath = path.join(workspaceRoot, '.git');
      const gitignorePath = path.join(workspaceRoot, '.gitignore');

      // Check if .git exists
      const gitExists = await fs
        .access(gitPath)
        .then(() => true)
        .catch(() => false);

      if (!gitExists) {
        return null; // No .git, no warning needed
      }

      // Check if .gitignore exists and contains .freedom-cli
      const gitignoreExists = await fs
        .access(gitignorePath)
        .then(() => true)
        .catch(() => false);

      if (gitignoreExists) {
        const content = await fs.readFile(gitignorePath, 'utf-8');
        if (!content.includes('.freedom-cli')) {
          return 'Tip: Add .freedom-cli/ to .gitignore to exclude session history from version control.';
        }
      } else {
        return 'Tip: Create a .gitignore file and add .freedom-cli/ to exclude session history from version control.';
      }

      return null;
    } catch (_err: unknown) {
      // If we can't check git/gitignore, skip silently
      return null;
    }
  },
};

const WARNING_CHECKS: readonly WarningCheck[] = [
  rootDirectoryCheck, // Most critical first
  homeDirectoryCheck,
  gitIgnoredCheck,
];

export async function getWorkspaceWarnings(
  workspaceRoot: string = process.cwd()
): Promise<string[]> {
  const results = await Promise.all(
    WARNING_CHECKS.map((check) => check.check(workspaceRoot))
  );
  return results.filter((msg): msg is string => msg !== null);
}
