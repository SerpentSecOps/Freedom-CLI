import { toolRegistry } from './dist/tools/registry.js';
import { registerCoreTools } from './dist/tools/index.js';

registerCoreTools();

console.log('\n🛠️  Agentic CLI - Registered Tools\n');
console.log('Total tools:', toolRegistry['tools'].size, '\n');

let readOnlyCount = 0;
let writeCount = 0;

for (const [name, tool] of toolRegistry['tools'].entries()) {
  // Determine if tool requires confirmation (use safe test input)
  let needsConfirm = '  ';
  if (tool.shouldConfirm) {
    try {
      // Git commit, push always need confirmation
      if (['git_commit', 'git_push'].includes(name)) {
        needsConfirm = '🔒';
      } else {
        needsConfirm = tool.shouldConfirm({}) ? '🔒' : '  ';
      }
    } catch {
      // If shouldConfirm throws with empty input, assume it needs confirmation
      needsConfirm = '🔒';
    }
  }

  const category = name.startsWith('git_') ? '[GIT]' :
                   ['read', 'glob', 'grep'].includes(name) ? '[READ]' :
                   ['write', 'edit'].includes(name) ? '[WRITE]' :
                   '[EXEC]';

  if (needsConfirm === '🔒') {
    writeCount++;
  } else {
    readOnlyCount++;
  }

  console.log(`${needsConfirm} ${category.padEnd(8)} ${name.padEnd(15)} - ${tool.definition.description.split('.')[0]}`);
}

console.log('\nRead-only tools:', readOnlyCount);
console.log('Write tools (require confirmation):', writeCount);
