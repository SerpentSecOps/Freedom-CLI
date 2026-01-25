/**
 * Settings Web Server
 * Provides a web-based UI for managing Freedom CLI settings
 */

import express from 'express';
import { createServer } from 'http';
import { getConfig, updateConfig } from './config.js';
import { toolRegistry, CONTINUOUS_MODE_DEFAULT_TOOLS } from './tools/index.js';
import open from 'open';

const PORT = 7337;

// Tool categories with descriptions
interface ToolCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
}

const TOOL_CATEGORIES: ToolCategory[] = [
  {
    id: 'file',
    name: 'File Operations',
    description: 'Read, write, and edit files',
    icon: '📁',
    color: '#58a6ff'
  },
  {
    id: 'search',
    name: 'Search & Discovery',
    description: 'Find files and search content',
    icon: '🔍',
    color: '#a371f7'
  },
  {
    id: 'shell',
    name: 'Shell & System',
    description: 'Run commands and system operations',
    icon: '⚡',
    color: '#f0883e'
  },
  {
    id: 'git',
    name: 'Git & Version Control',
    description: 'Git operations and repository management',
    icon: '🔀',
    color: '#3fb950'
  },
  {
    id: 'web',
    name: 'Web & Network',
    description: 'Web search and network operations',
    icon: '🌐',
    color: '#39d353'
  },
  {
    id: 'code',
    name: 'Code Intelligence',
    description: 'LSP, documentation, and code analysis',
    icon: '🧠',
    color: '#db61a2'
  },
  {
    id: 'mcp',
    name: 'MCP Extensions',
    description: 'Tools from Model Context Protocol servers',
    icon: '🔌',
    color: '#8b949e'
  }
];

// Map tool names to categories
function getToolCategory(toolName: string): string {
  // File operations
  if (['read', 'write', 'edit'].includes(toolName)) return 'file';

  // Search & discovery
  if (['glob', 'grep', 'path_info'].includes(toolName)) return 'search';

  // Shell & system
  if (['bash', 'task_output'].includes(toolName)) return 'shell';

  // Git tools
  if (toolName.startsWith('git_')) return 'git';

  // Web & network
  if (['web_search'].includes(toolName)) return 'web';

  // Code intelligence
  if (['LSP', 'lsp'].includes(toolName)) return 'code';
  if (toolName.includes('context7') || toolName.includes('query-docs') || toolName.includes('resolve-library')) return 'code';

  // MCP tools
  if (toolName.includes('__') || toolName.includes('mcp') || toolName.startsWith('list_mcp') || toolName.startsWith('read_mcp') || toolName.startsWith('get_mcp')) return 'mcp';

  // Default to shell
  return 'shell';
}

// HTML template for the settings page
function getSettingsHTML(config: any, tools: any[], mcpServers: Record<string, any>, disabledTools: string[]): string {

  // Get continuous mode allowed tools (custom or defaults)
  const continuousAllowedTools: string[] = config.continuousMode?.allowedTools || CONTINUOUS_MODE_DEFAULT_TOOLS;
  const continuousAdditionalTools: string[] = config.continuousMode?.additionalTools || [];
  const allContinuousTools = new Set([...continuousAllowedTools, ...continuousAdditionalTools]);

  // Group tools by category
  const toolsByCategory: Record<string, any[]> = {};
  TOOL_CATEGORIES.forEach(cat => toolsByCategory[cat.id] = []);

  tools.forEach(tool => {
    const category = getToolCategory(tool.name);
    if (!toolsByCategory[category]) toolsByCategory[category] = [];
    toolsByCategory[category].push(tool);
  });

  // Generate HTML for each category
  const categoriesHTML = TOOL_CATEGORIES.map(category => {
    const categoryTools = toolsByCategory[category.id] || [];
    if (categoryTools.length === 0) return '';

    const enabledCount = categoryTools.filter(t => !disabledTools.includes(t.name)).length;

    const toolsHTML = categoryTools.map(tool => {
      const isDisabled = disabledTools.includes(tool.name);
      const isInContinuous = allContinuousTools.has(tool.name);
      return `
        <div class="tool-item">
          <label class="toggle">
            <input type="checkbox" ${!isDisabled ? 'checked' : ''} data-tool="${tool.name}" data-category="${category.id}" class="tool-enabled">
            <span class="slider"></span>
          </label>
          <div class="tool-info">
            <span class="tool-name">${tool.name}</span>
            <span class="tool-desc">${tool.description.substring(0, 100)}${tool.description.length > 100 ? '...' : ''}</span>
          </div>
          <label class="continuous-toggle" title="Available in Continuous Mode">
            <input type="checkbox" ${isInContinuous ? 'checked' : ''} data-tool-continuous="${tool.name}" class="tool-continuous">
            <span class="continuous-label">🔄</span>
          </label>
        </div>
      `;
    }).join('');

    return `
      <div class="category-section" data-category="${category.id}">
        <div class="category-header" style="--cat-color: ${category.color}">
          <div class="category-title">
            <span class="category-icon">${category.icon}</span>
            <div>
              <h3>${category.name}</h3>
              <p class="category-desc">${category.description}</p>
            </div>
          </div>
          <div class="category-controls">
            <span class="category-count">${enabledCount}/${categoryTools.length}</span>
            <button class="btn btn-sm btn-toggle-all" onclick="toggleCategory('${category.id}', true)">All</button>
            <button class="btn btn-sm btn-toggle-none" onclick="toggleCategory('${category.id}', false)">None</button>
          </div>
        </div>
        <div class="category-tools">
          ${toolsHTML}
        </div>
      </div>
    `;
  }).join('');

  const mcpHTML = Object.entries(mcpServers).map(([name, serverConfig]: [string, any]) => {
    const isStdio = !!serverConfig.command;
    return `
      <div class="mcp-item">
        <div class="mcp-header">
          <span class="mcp-name">${name}</span>
          <span class="mcp-type">${isStdio ? 'stdio' : 'http'}</span>
          <button class="btn btn-danger btn-sm" onclick="removeMCP('${name}')">Remove</button>
        </div>
        <div class="mcp-details">
          ${isStdio ? `<code>${serverConfig.command} ${(serverConfig.args || []).join(' ')}</code>` : `<code>${serverConfig.url}</code>`}
        </div>
      </div>
    `;
  }).join('') || '<p class="text-muted">No MCP servers configured</p>';

  const totalTools = tools.length;
  const enabledTools = tools.length - disabledTools.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Freedom CLI Settings</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #21262d;
      --border: #30363d;
      --text: #e6edf3;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --success: #3fb950;
      --danger: #f85149;
      --warning: #d29922;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 2rem;
    }

    .container { max-width: 900px; margin: 0 auto; }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border);
    }

    h1 { font-size: 1.8rem; font-weight: 600; }
    h1 span { color: var(--accent); }

    .btn {
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9rem;
      font-weight: 500;
      transition: all 0.2s;
    }

    .btn-primary { background: var(--accent); color: #000; }
    .btn-primary:hover { opacity: 0.9; }
    .btn-danger { background: var(--danger); color: #fff; }
    .btn-sm { padding: 0.25rem 0.6rem; font-size: 0.75rem; }
    .btn-toggle-all { background: var(--success); color: #fff; }
    .btn-toggle-none { background: var(--bg); color: var(--text-muted); border: 1px solid var(--border); }

    .section {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 1.5rem;
      overflow: hidden;
    }

    .section-header {
      padding: 1rem 1.5rem;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .section-header h2 { font-size: 1.1rem; font-weight: 600; }
    .section-body { padding: 1rem 1.5rem; }

    /* Category sections */
    .category-section {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 1rem;
      overflow: hidden;
    }

    .category-header {
      padding: 1rem 1.25rem;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-left: 3px solid var(--cat-color);
    }

    .category-title {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .category-icon { font-size: 1.5rem; }

    .category-title h3 {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 0.1rem;
    }

    .category-desc {
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    .category-controls {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .category-count {
      font-size: 0.85rem;
      color: var(--text-muted);
      margin-right: 0.5rem;
    }

    .category-tools { padding: 0.5rem 1rem; }

    .tool-item {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.6rem 0.25rem;
      border-bottom: 1px solid var(--border);
    }

    .tool-item:last-child { border-bottom: none; }

    .tool-info { flex: 1; min-width: 0; }

    /* Continuous mode toggle per tool */
    .continuous-toggle {
      display: flex;
      align-items: center;
      cursor: pointer;
      opacity: 0.5;
      transition: opacity 0.2s;
    }

    .continuous-toggle:hover { opacity: 1; }

    .continuous-toggle input {
      display: none;
    }

    .continuous-toggle input:checked + .continuous-label {
      opacity: 1;
      background: var(--warning);
      border-radius: 4px;
      padding: 2px 4px;
    }

    .continuous-label {
      font-size: 0.9rem;
      opacity: 0.4;
      transition: all 0.2s;
    }

    .tool-name {
      font-weight: 500;
      font-family: monospace;
      color: var(--accent);
      font-size: 0.9rem;
    }

    .tool-desc {
      display: block;
      font-size: 0.8rem;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Toggle switch */
    .toggle {
      position: relative;
      width: 40px;
      height: 22px;
      flex-shrink: 0;
    }

    .toggle input { opacity: 0; width: 0; height: 0; }

    .slider {
      position: absolute;
      cursor: pointer;
      top: 0; left: 0; right: 0; bottom: 0;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 22px;
      transition: 0.3s;
    }

    .slider:before {
      position: absolute;
      content: "";
      height: 16px;
      width: 16px;
      left: 2px;
      bottom: 2px;
      background: var(--text-muted);
      border-radius: 50%;
      transition: 0.3s;
    }

    .toggle input:checked + .slider {
      background: var(--success);
      border-color: var(--success);
    }

    .toggle input:checked + .slider:before {
      transform: translateX(18px);
      background: #fff;
    }

    /* MCP section */
    .mcp-item {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 1rem;
      margin-bottom: 0.75rem;
    }

    .mcp-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.5rem;
    }

    .mcp-name { font-weight: 600; font-family: monospace; }

    .mcp-type {
      font-size: 0.75rem;
      padding: 0.15rem 0.5rem;
      background: var(--bg-tertiary);
      border-radius: 4px;
      color: var(--text-muted);
    }

    .mcp-details code {
      font-size: 0.85rem;
      color: var(--text-muted);
    }

    /* Config grid */
    .config-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 1rem;
    }

    .config-item {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .config-item label {
      font-size: 0.9rem;
      color: var(--text-muted);
    }

    .config-item input, .config-item select {
      padding: 0.5rem 0.75rem;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 0.9rem;
    }

    .config-item input:focus, .config-item select:focus {
      outline: none;
      border-color: var(--accent);
    }

    .text-muted { color: var(--text-muted); }

    /* Stats bar */
    .stats-bar {
      display: flex;
      gap: 1.5rem;
      margin-bottom: 1.5rem;
      padding: 1rem 1.5rem;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
    }

    .stat {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .stat-value {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--accent);
    }

    .stat-label {
      font-size: 0.85rem;
      color: var(--text-muted);
    }

    /* Toast */
    .toast {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      padding: 1rem 1.5rem;
      background: var(--success);
      color: #fff;
      border-radius: 8px;
      font-weight: 500;
      transform: translateY(100px);
      opacity: 0;
      transition: all 0.3s;
      z-index: 1000;
    }

    .toast.show {
      transform: translateY(0);
      opacity: 1;
    }

    /* Token estimate */
    .token-estimate {
      background: var(--bg);
      padding: 0.75rem 1rem;
      border-radius: 6px;
      border: 1px solid var(--border);
      margin-top: 0.5rem;
    }

    .token-bar {
      height: 6px;
      background: var(--bg-tertiary);
      border-radius: 3px;
      overflow: hidden;
      margin-top: 0.5rem;
    }

    .token-bar-fill {
      height: 100%;
      background: var(--success);
      transition: width 0.3s;
    }

    .token-bar-fill.warning { background: var(--warning); }
    .token-bar-fill.danger { background: var(--danger); }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1><span>Freedom</span> CLI Settings</h1>
      <button class="btn btn-primary" onclick="saveAll()">Save Changes</button>
    </header>

    <div class="stats-bar">
      <div class="stat">
        <span class="stat-value" id="enabledCount">${enabledTools}</span>
        <span class="stat-label">/ ${totalTools} tools enabled</span>
      </div>
      <div class="stat">
        <span class="stat-value">${Object.keys(mcpServers).length}</span>
        <span class="stat-label">MCP servers</span>
      </div>
      <div class="token-estimate">
        <span class="text-muted">Est. tokens per request: </span>
        <strong id="tokenEstimate">~${enabledTools * 200 + 1000}</strong>
        <div class="token-bar">
          <div class="token-bar-fill" id="tokenBar" style="width: ${Math.min(100, (enabledTools * 200 + 1000) / 80)}%"></div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <h2>General Settings</h2>
      </div>
      <div class="section-body">
        <div class="config-grid">
          <div class="config-item">
            <label>Context Limit (tokens)</label>
            <input type="number" id="contextLimit" value="${config.contextLimit || 180000}">
          </div>
          <div class="config-item">
            <label>Auto Compact</label>
            <select id="autoCompact">
              <option value="true" ${config.autoCompact ? 'selected' : ''}>Enabled</option>
              <option value="false" ${!config.autoCompact ? 'selected' : ''}>Disabled</option>
            </select>
          </div>
          <div class="config-item">
            <label>Compact Method</label>
            <select id="compactMethod">
              <option value="smart" ${config.compactMethod === 'smart' ? 'selected' : ''}>Smart</option>
              <option value="semantic" ${config.compactMethod === 'semantic' ? 'selected' : ''}>Semantic</option>
              <option value="simple" ${config.compactMethod === 'simple' ? 'selected' : ''}>Simple</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <h2>🔄 Continuous Mode</h2>
        <span class="text-muted">Minimal tools for unsupervised autonomous operation</span>
      </div>
      <div class="section-body">
        <p class="text-muted" style="margin-bottom: 1rem;">
          When enabled, only essential coding tools are available. This reduces context size and limits capabilities for safer unsupervised operation.
        </p>
        <div class="config-grid">
          <div class="config-item">
            <label style="display: flex; align-items: center; gap: 0.75rem; cursor: pointer;">
              <label class="toggle">
                <input type="checkbox" id="continuousModeEnabled" ${config.continuousMode ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
              <span>Enable Continuous Mode</span>
            </label>
            <span class="text-muted" style="font-size: 0.8rem; margin-top: 0.25rem;">
              Restricts tools to: bash, read, write, edit, glob, grep, git basics, lsp
            </span>
          </div>
          <div class="config-item">
            <label style="display: flex; align-items: center; gap: 0.75rem; cursor: pointer;">
              <label class="toggle">
                <input type="checkbox" id="continuousModeWeb" ${config.continuousMode?.enableWeb ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
              <span>Allow Web Tools</span>
            </label>
            <span class="text-muted" style="font-size: 0.8rem; margin-top: 0.25rem;">
              Enable web_search in continuous mode (default: off)
            </span>
          </div>
          <div class="config-item">
            <label style="display: flex; align-items: center; gap: 0.75rem; cursor: pointer;">
              <label class="toggle">
                <input type="checkbox" id="continuousModeMcp" ${config.continuousMode?.enableMcp ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
              <span>Allow MCP Servers</span>
            </label>
            <span class="text-muted" style="font-size: 0.8rem; margin-top: 0.25rem;">
              Load MCP server tools in continuous mode (default: off)
            </span>
          </div>
        </div>
      </div>
    </div>

    <h2 style="margin-bottom: 1rem; font-size: 1.2rem;">Tools by Category</h2>

    ${categoriesHTML}

    <div class="section">
      <div class="section-header">
        <h2>MCP Servers</h2>
      </div>
      <div class="section-body" id="mcpList">
        ${mcpHTML}
      </div>
    </div>
  </div>

  <div class="toast" id="toast">Settings saved!</div>

  <script>
    // Update counts and token estimate
    function updateStats() {
      const total = document.querySelectorAll('.tool-enabled').length;
      const enabled = document.querySelectorAll('.tool-enabled:checked').length;
      document.getElementById('enabledCount').textContent = enabled;

      // Update category counts
      document.querySelectorAll('.category-section').forEach(section => {
        const catId = section.dataset.category;
        const catTotal = section.querySelectorAll('.tool-enabled').length;
        const catEnabled = section.querySelectorAll('.tool-enabled:checked').length;
        section.querySelector('.category-count').textContent = catEnabled + '/' + catTotal;
      });

      // Token estimate (~200 tokens per tool + 1000 base)
      const tokens = enabled * 200 + 1000;
      document.getElementById('tokenEstimate').textContent = '~' + tokens;

      const bar = document.getElementById('tokenBar');
      const pct = Math.min(100, tokens / 80);
      bar.style.width = pct + '%';
      bar.className = 'token-bar-fill';
      if (tokens > 6000) bar.classList.add('danger');
      else if (tokens > 4000) bar.classList.add('warning');
    }

    document.querySelectorAll('.tool-enabled').forEach(input => {
      input.addEventListener('change', updateStats);
    });

    // Toggle all tools in a category
    function toggleCategory(categoryId, enable) {
      const section = document.querySelector('.category-section[data-category="' + categoryId + '"]');
      section.querySelectorAll('.tool-enabled').forEach(input => {
        input.checked = enable;
      });
      updateStats();
    }

    // Save all settings
    async function saveAll() {
      const disabledTools = [];
      document.querySelectorAll('.tool-enabled').forEach(input => {
        if (!input.checked && input.dataset.tool) {
          disabledTools.push(input.dataset.tool);
        }
      });

      // Collect tools allowed in continuous mode
      const continuousModeTools = [];
      document.querySelectorAll('.tool-continuous').forEach(input => {
        if (input.checked && input.dataset.toolContinuous) {
          continuousModeTools.push(input.dataset.toolContinuous);
        }
      });

      // Continuous mode settings
      const continuousModeEnabled = document.getElementById('continuousModeEnabled').checked;
      const continuousMode = continuousModeEnabled ? {
        allowedTools: continuousModeTools,
        enableWeb: document.getElementById('continuousModeWeb').checked,
        enableMcp: document.getElementById('continuousModeMcp').checked
      } : null;

      const settings = {
        contextLimit: parseInt(document.getElementById('contextLimit').value),
        autoCompact: document.getElementById('autoCompact').value === 'true',
        compactMethod: document.getElementById('compactMethod').value,
        disabledTools: disabledTools,
        continuousMode: continuousMode
      };

      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settings)
        });

        if (res.ok) {
          showToast('Settings saved!');
        } else {
          showToast('Failed to save settings');
        }
      } catch (e) {
        showToast('Error saving settings');
      }
    }

    // Remove MCP server
    async function removeMCP(name) {
      if (!confirm('Remove MCP server "' + name + '"?')) return;

      try {
        const res = await fetch('/api/mcp/' + encodeURIComponent(name), {
          method: 'DELETE'
        });

        if (res.ok) {
          location.reload();
        } else {
          showToast('Failed to remove MCP server');
        }
      } catch (e) {
        showToast('Error removing MCP server');
      }
    }

    function showToast(message) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // Initial stats
    updateStats();
  </script>
</body>
</html>`;
}

export async function startSettingsServer(): Promise<{ url: string; close: () => void }> {
  const app = express();
  app.use(express.json());

  // Main settings page
  app.get('/', (_req, res) => {
    const config = getConfig();
    const tools = toolRegistry.getAllTools().map(t => ({
      name: t.definition.name,
      description: t.definition.description
    }));
    const mcpServers = config.mcpServers || {};
    const disabledTools: string[] = (config as any).disabledTools || [];

    res.send(getSettingsHTML(config, tools, mcpServers, disabledTools));
  });

  // API: Get settings
  app.get('/api/settings', (_req, res) => {
    const config = getConfig();
    res.json(config);
  });

  // API: Save settings
  app.post('/api/settings', (req, res) => {
    try {
      const { contextLimit, autoCompact, compactMethod, disabledTools, continuousMode } = req.body;

      updateConfig({
        contextLimit,
        autoCompact,
        compactMethod,
        disabledTools,
        continuousMode
      } as any);

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API: Get tools
  app.get('/api/tools', (_req, res) => {
    const tools = toolRegistry.getAllTools().map(t => ({
      name: t.definition.name,
      description: t.definition.description
    }));
    res.json(tools);
  });

  // API: Remove MCP server
  app.delete('/api/mcp/:name', async (req, res) => {
    try {
      const config = getConfig();
      const mcpServers = { ...(config.mcpServers || {}) };
      const name = req.params.name;

      if (!mcpServers[name]) {
        return res.status(404).json({ error: 'MCP server not found' });
      }

      delete mcpServers[name];
      await updateConfig({ mcpServers });

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Start server
  const server = createServer(app);

  return new Promise((resolve) => {
    server.listen(PORT, () => {
      const url = `http://localhost:${PORT}`;
      resolve({
        url,
        close: () => server.close()
      });
    });
  });
}

export async function openSettings(): Promise<void> {
  const { url, close } = await startSettingsServer();

  console.log(`\n🌐 Settings server running at ${url}`);
  console.log('   Opening in browser...\n');

  await open(url);

  // Keep server running for 5 minutes, then auto-close
  setTimeout(() => {
    close();
    console.log('\n⏱️  Settings server closed (timeout)\n');
  }, 5 * 60 * 1000);
}
