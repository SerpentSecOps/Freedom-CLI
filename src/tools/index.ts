/**
 * Tool exports and initialization
 */

export {
  toolRegistry,
  ToolRegistry,
  CONTINUOUS_MODE_DEFAULT_TOOLS,
  WEB_TOOLS,
  GIT_EXTENDED_TOOLS,
} from './registry.js';
export { bashTool } from './bash.js';
export { readTool } from './read.js';
export { writeTool } from './write.js';
export { editTool } from './edit.js';
export { editLinesTool } from './edit-lines.js';
export { globTool } from './glob.js';
export { grepTool } from './grep.js';
export { askQuestionTool } from './ask-question.js';
export { taskOutputTool } from './task-output.js';
export { lspTool } from './lsp.js';
export { webSearchTool } from './web-search.js';
export { todoTool } from './todo.js';
export { recallTool } from './recall.js';
export {
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitAddTool,
  gitCommitTool,
  gitPushTool,
  gitBranchTool,
  gitCheckoutTool,
} from './git.js';

import { toolRegistry } from './registry.js';
import { bashTool } from './bash.js';
import { readTool } from './read.js';
import { writeTool } from './write.js';
import { editTool } from './edit.js';
import { editLinesTool } from './edit-lines.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { taskOutputTool } from './task-output.js';
import { lspTool } from './lsp.js';
import { pathInfoTool } from './path-info.js';
import { webSearchTool } from './web-search.js';
import { todoTool } from './todo.js';
import { recallTool } from './recall.js';
import {
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitAddTool,
  gitCommitTool,
  gitPushTool,
  gitBranchTool,
  gitCheckoutTool,
} from './git.js';

/**
 * Register all core tools
 */
export function registerCoreTools(): void {
  toolRegistry.register(bashTool);
  toolRegistry.register(readTool);
  toolRegistry.register(writeTool);
  toolRegistry.register(editTool);
  toolRegistry.register(editLinesTool);
  toolRegistry.register(globTool);
  toolRegistry.register(grepTool);
  toolRegistry.register(taskOutputTool);
  toolRegistry.register(lspTool);
  toolRegistry.register(pathInfoTool);
  toolRegistry.register(webSearchTool);
  toolRegistry.register(todoTool);
  toolRegistry.register(recallTool);

  // Git tools
  toolRegistry.register(gitStatusTool);
  toolRegistry.register(gitDiffTool);
  toolRegistry.register(gitLogTool);
  toolRegistry.register(gitAddTool);
  toolRegistry.register(gitCommitTool);
  toolRegistry.register(gitPushTool);
  toolRegistry.register(gitBranchTool);
  toolRegistry.register(gitCheckoutTool);
}
