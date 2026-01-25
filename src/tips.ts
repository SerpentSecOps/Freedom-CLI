/**
 * Helpful Tips System
 * Shows random tips to users on startup to improve discoverability
 */

/**
 * Collection of helpful tips for Freedom CLI users
 * Organized by category for maintainability
 */
export const TIPS = [
  // Command tips
  'Start a chat session with: freedom-cli chat',
  'Execute a one-off prompt with: freedom-cli exec "your prompt"',
  'Resume your last session with: freedom-cli resume',
  'List all saved sessions with: freedom-cli list-sessions',
  'View current configuration with: freedom-cli config',
  'Check MCP server status with: freedom-cli mcp',

  // Feature tips
  'Use @{file.txt} to inject file contents into your prompt',
  'Use !{command} to inject command output into your prompt (requires --auto-approve)',
  'Background tasks run async - use task_output to retrieve results',
  'Parallel tool execution speeds up multi-step operations',
  'Session cleanup prevents unbounded disk usage (configurable in config.json)',

  // MCP tips
  'Connect to external tools via MCP servers (stdio, SSE, or HTTP)',
  'MCP servers can provide unlimited custom tools',
  'Set trust: true in MCP config to skip confirmations for safe tools',
  'Use includeTools/excludeTools to filter MCP tools',
  'OAuth-enabled MCP servers unlock enterprise integrations',

  // Git tips
  'Built-in Git tools: git_status, git_diff, git_log, git_add, git_commit, git_push',
  'Git operations require confirmation unless auto-approved',
  'Use git_log with --count to limit commit history',
  'git_diff supports both staged and unstaged changes',

  // Configuration tips
  'Configure API key in ~/.freedom-cli/config.json or ANTHROPIC_API_KEY env var',
  'Set autoApprove: true in config.json to skip all confirmations',
  'Adjust maxTurns to limit conversation length',
  'Session retention policy: maxAge and maxCount in sessionCleanup config',
  'Add MCP servers to config.json under mcpServers key',

  // Performance tips
  'Health checks validate API connectivity on startup',
  'Context window management truncates old messages automatically',
  'Markdown formatting improves readability of agent responses',
  'Tool indicators show real-time progress with elapsed time',

  // Keyboard shortcuts
  'Press Ctrl+C to cancel the current request',
  'Press Ctrl+D to exit interactive chat',
  'Use arrow keys to navigate command history',

  // Best practices
  'Use exec mode for automation and CI/CD pipelines',
  'Enable --auto-approve carefully - it skips safety confirmations',
  'Review tool confirmations to understand what the agent is doing',
  'Check session files in ~/.freedom-cli/sessions/ for debugging',
];

/**
 * Get a random tip from the collection
 */
export function getRandomTip(): string {
  const index = Math.floor(Math.random() * TIPS.length);
  return TIPS[index];
}

/**
 * Format a tip for display
 */
export function formatTip(tip: string): string {
  return `💡 Tip: ${tip}`;
}
