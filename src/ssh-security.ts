/**
 * Security validation for SSH remote execution
 * Prevents command injection and path traversal attacks
 */

/**
 * Dangerous command patterns that should be blocked
 */
const DANGEROUS_PATTERNS = [
  /;\s*rm\s+-rf/i,                    // rm -rf via command chaining
  /&&\s*rm\s+-rf/i,                   // rm -rf via AND
  /\|\s*rm\s+-rf/i,                   // rm -rf via pipe
  /`.*rm\s+-rf.*`/i,                  // rm -rf via backticks
  /\$\(.*rm\s+-rf.*\)/i,              // rm -rf via $()
  />\s*\/dev\/sd[a-z]/i,              // Direct disk write
  /mkfs/i,                            // Format filesystem
  /dd\s+if=/i,                        // Disk dump
  /:\(\)\{.*;\}/,                     // Fork bomb
  /curl.*\|\s*(bash|sh)/i,            // Pipe to shell
  /wget.*\|\s*(bash|sh)/i,            // Pipe to shell
];

/**
 * Sensitive paths that should not be accessed
 */
const SENSITIVE_PATHS = [
  '/etc/shadow',
  '/etc/passwd',
  '/etc/sudoers',
  '/root/.ssh',
  '/home/*/.ssh/id_rsa',
  '/home/*/.ssh/id_ed25519',
  '~/.ssh/id_rsa',
  '~/.ssh/id_ed25519',
];

/**
 * Sanitize a command before execution via SSH
 * @param cmd Command to sanitize
 * @returns Sanitized command
 * @throws Error if dangerous patterns detected
 */
export function sanitizeCommand(cmd: string): string {
  if (!cmd || typeof cmd !== 'string') {
    throw new Error('Invalid command: must be a non-empty string');
  }

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(cmd)) {
      throw new Error(`Dangerous command pattern blocked: ${pattern.toString()}`);
    }
  }

  // Block null bytes (can be used for injection)
  if (cmd.includes('\0')) {
    throw new Error('Null bytes in command are not allowed');
  }

  // Warn about potentially risky operations (but don't block)
  if (/sudo/i.test(cmd)) {
    console.warn('⚠️  Warning: Command uses sudo (requires remote password)');
  }

  return cmd;
}

/**
 * Validate a file path before remote access
 * @param path Path to validate
 * @throws Error if path is dangerous
 */
export function validatePath(path: string): void {
  if (!path || typeof path !== 'string') {
    throw new Error('Invalid path: must be a non-empty string');
  }

  // Block path traversal attempts
  if (path.includes('../') || path.includes('..\\')) {
    throw new Error('Path traversal blocked: .. not allowed');
  }

  // Block null bytes
  if (path.includes('\0')) {
    throw new Error('Null bytes in path are not allowed');
  }

  // Check against sensitive paths
  for (const sensitivePath of SENSITIVE_PATHS) {
    // Simple wildcard matching
    const pattern = sensitivePath.replace(/\*/g, '.*');
    const regex = new RegExp(`^${pattern}$`);

    if (regex.test(path) || path.startsWith(sensitivePath.replace('*', ''))) {
      throw new Error(`Access to sensitive path blocked: ${path}`);
    }
  }

  // Warn about root-level operations
  if (path === '/' || path === '/etc' || path === '/root') {
    console.warn(`⚠️  Warning: Operating on system path: ${path}`);
  }
}

/**
 * Safely escape a path for use in shell commands
 * @param path Path to escape
 * @returns Escaped path
 */
export function escapePath(path: string): string {
  // Use single quotes and escape any existing single quotes
  return `'${path.replace(/'/g, "'\\''")}'`;
}

/**
 * Safely escape a command argument
 * @param arg Argument to escape
 * @returns Escaped argument
 */
export function escapeArg(arg: string): string {
  // Use double quotes and escape special characters
  return `"${arg.replace(/(["\$`\\])/g, '\\$1')}"`;
}

/**
 * Parse SSH URI into components
 * Supports: ssh://user@host:port, user@host:port, user@host
 * @param uri SSH URI string
 * @returns Parsed URI components
 */
export function parseSSHUri(uri: string): { username: string; host: string; port: number } {
  if (!uri || typeof uri !== 'string') {
    throw new Error('Invalid SSH URI: must be a non-empty string');
  }

  // Remove ssh:// prefix if present
  let cleanUri = uri.replace(/^ssh:\/\//, '');

  // Extract port if present
  let port = 22;
  const portMatch = cleanUri.match(/:(\d+)$/);
  if (portMatch) {
    port = parseInt(portMatch[1], 10);
    cleanUri = cleanUri.replace(/:(\d+)$/, '');
  }

  // Extract username and host
  const parts = cleanUri.split('@');
  if (parts.length !== 2) {
    throw new Error('Invalid SSH URI format. Expected: [ssh://]user@host[:port]');
  }

  const [username, host] = parts;

  if (!username || !host) {
    throw new Error('Invalid SSH URI: username and host are required');
  }

  // Validate host format (basic check)
  if (!/^[a-zA-Z0-9.-]+$/.test(host) && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    throw new Error('Invalid host format');
  }

  // Validate port range
  if (port < 1 || port > 65535) {
    throw new Error('Invalid port: must be between 1 and 65535');
  }

  return { username, host, port };
}

/**
 * Validate SSH connection configuration
 * @param config Configuration to validate
 * @throws Error if configuration is invalid
 */
export function validateSSHConfig(config: {
  host: string;
  port: number;
  username: string;
  privateKeyPath?: string;
  password?: string;
}): void {
  if (!config.host || typeof config.host !== 'string') {
    throw new Error('Invalid SSH config: host is required');
  }

  if (!config.username || typeof config.username !== 'string') {
    throw new Error('Invalid SSH config: username is required');
  }

  if (typeof config.port !== 'number' || config.port < 1 || config.port > 65535) {
    throw new Error('Invalid SSH config: port must be between 1 and 65535');
  }

  if (!config.privateKeyPath && !config.password) {
    throw new Error('Invalid SSH config: either privateKeyPath or password is required');
  }
}
