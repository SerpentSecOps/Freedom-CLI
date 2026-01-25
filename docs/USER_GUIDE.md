# Freedom CLI User Guide

**Choose your AI, keep your freedom.**

The Freedom CLI is an advanced, provider-agnostic terminal assistant designed for developers who demand complete control over their AI environment. Unlike closed ecosystems, Freedom CLI gives you granular control over context management, tool execution, and model memory.

---

## 📚 Table of Contents

1.  [Getting Started](#getting-started)
    *   [Installation](#installation)
    *   [First Run & Setup](#first-run--setup)
    *   [Basic Usage](#basic-usage)
2.  [Core Concepts](#core-concepts)
    *   [The Two Modes: Brainstorm vs. Build](#the-two-modes-brainstorm-vs-build)
    *   [Providers & Models](#providers--models)
    *   [Prompt Injection Syntax](#prompt-injection-syntax)
3.  [Power User Features](#power-user-features)
    *   [Context Management (The "Memory" System)](#context-management-the-memory-system)
    *   [Tool History & archiving](#tool-history--archiving)
    *   [Continuous Loop Mode](#continuous-loop-mode)
    *   [Prompt Injections (@ and !)](#prompt-injections--and-)
4.  [Command Reference](#command-reference)
    *   [Session Management](#session-management)
    *   [Configuration & Settings](#configuration--settings)
    *   [Memory & Context Controls](#memory--context-controls)
    *   [Tool History Controls](#tool-history-controls)
    *   [Environment & System](#environment--system)
    *   [Extensions (MCP, Plugins)](#extensions-mcp-plugins)
5.  [Configuration Reference](#configuration-reference)

---

## 🚀 Getting Started

### Installation

Ensure you have Node.js (v18+) installed.

```bash
# Clone the repository
git clone https://github.com/your-repo/freedom-cli.git
cd freedom-cli

# Install dependencies
npm install

# Build the project
npm run build

# Link globally (optional)
npm link
```

### First Run & Setup

To start the CLI, simply run:

```bash
npm start
# OR if linked:
freedom
```

On your first run, you will be guided through an interactive setup wizard to choose your AI provider:
*   **Anthropic:** Best for coding (Claude 3.5 Sonnet).
*   **DeepSeek:** Best cost/performance ratio (DeepSeek V3/R1).
*   **Google:** Gemini Pro via OAuth (no API key needed).
*   **LM Studio:** Local LLMs (free, private, runs on your hardware).

### Basic Usage

Once inside the CLI, just type your request and press **Enter**.

*   **Ask a question:** "Explain how dependency injection works."
*   **Request a task:** "Create a new file called `server.ts` with a basic Express app."
*   **Edit code:** "In `server.ts`, change the port to 8080."

**Keyboard Shortcuts:**
*   `Shift + Tab`: Toggle between **Brainstorm** (Read-only) and **Build** (Read/Write) modes.
*   `Shift + Up/Down`: Navigate command history.
*   `Ctrl + C`: Cancel current generation or exit.

---

## 🧠 Core Concepts

### The Two Modes: Brainstorm vs. Build

The CLI operates in two distinct modes to protect your code:

1.  **🔨 Build Mode (Default):**
    *   **Capabilities:** Full access. Can read files, write files, run shell commands, and edit code.
    *   **Use for:** Coding, refactoring, debugging, system administration.
    *   **Indicator:** Blue "Build" badge.

2.  **💭 Brainstorm Mode:**
    *   **Capabilities:** **Read-only.** Can read files and search, but *cannot* modify files or run dangerous commands.
    *   **Use for:** Asking questions, planning features, understanding a codebase safely.
    *   **Indicator:** Gold "Brainstorm" badge.
    *   **Toggle:** Press `Shift + Tab` to switch instantly.

### Providers & Models

Freedom CLI supports hot-swapping models. You are not locked into one vendor.

*   **Switching Models:** Use `/model` to open the selection menu.
*   **Anthropic:** High intelligence, good with complex instructions.
*   **DeepSeek:** Extremely cheap, large context (128k), great reasoning (R1).
*   **LM Studio:** Connects to `http://localhost:1234/v1`. Perfect for offline/privacy.
*   **Google:** Uses Gemini 1.5 Pro via Cloud Code auth.

---

### 🔒 API Key Security

Freedom CLI includes a professional **Secret Manager** to handle your API keys securely.

*   **Primary Storage:** Your OS Keychain (macOS Keychain, Windows Vault, Linux Secret Service). Keys are encrypted by the OS.
*   **Secondary Storage:** A secure `.env` file in `~/.freedom-cli/.env` with `chmod 600` permissions.
*   **Legacy Storage:** Plain text `config.json` (not recommended).

**Commands:**
*   **`/apienv` (Default):** Use secure storage (Keychain + `.env`).
*   **`/apifile`:** Use legacy storage (plain text `config.json`).

The CLI automatically prioritizes system environment variables if you prefer to manage them yourself (e.g., via `.bashrc`).

---

## ⌨️ Command Reference

### Safety & Secrets
| Command | Description |
| :--- | :--- |
| `/freedom` | Open the Four-Tier Safety selection menu. |
| `/apienv` | Store API keys in secure Keychain/.env (Default). |
| `/apifile` | Store API keys in plain text config.json. |
| `/toolturn [n]` | Master switch: Archive all tool data after N turns. |


### Environment & System
| Command | Description |
| :--- | :--- |
| `/image [path]` | Attach an image to the next message. |
| `/image clear` | Clear pending images. |
| `/agents` | List/reload custom Copilot-compatible agents. |
| `/skills` | List/reload loaded skills. |
| `/instructions` | Manage custom system instructions. |

### Extensions (MCP, Plugins)
| Command | Description |
| :--- | :--- |
| `/mcp list` | List active MCP servers. |
| `/mcp add` | Add an MCP server. |
| `/plugin` | Manage plugins and marketplaces. |

---

## ⚙️ Configuration Reference

Your configuration is stored in `~/.freedom-cli/config.json`. You can edit this file directly or use the CLI commands.

```json
{
  "apiKey": "sk-...",
  "model": "claude-3-5-sonnet-20240620",
  "provider": "anthropic",
  
  "// Context Settings": "",
  "maxTokens": 8192,
  "contextLimit": 180000,
  "autoCompact": false,
  
  "// Tool History (The 'Magic Numbers')": "",
  "historyKeepTurns": 2,          // Master setting
  "historyKeepInputTurns": 2,     // Input retention turns
  "historyKeepOutputTurns": 2,    // Output retention turns
  "historyArchiveLimit": 500,     // Archive if > 500 chars
  "historyOutputLimit": 5000,     // Truncate active output at 5000 chars
  "historyInputHeadCharacters": 200, // Keep first 200 chars of archived code
  "historyInputTailCharacters": 100, // Keep last 100 chars of archived code
  
  "// Safety": "",
  "quarantinedPaths": ["/etc", "/var"],
  "autoApprove": false,
  
  "// Timeouts (ms)": "",
  "apiTimeout": 180000,
  "toolTimeout": 120000
}
```

---

## ⚠️ Troubleshooting

**"Prompt Injection" or "Context Stale" errors:**
*   This usually happens when line numbers shift after edits.
*   **Fix:** Use `/tooloutput 0` to force the model to re-read files constantly, or rely on the `edit` tool (search/replace) instead of `edit_lines`.

**DeepSeek/Local Model "Context Window Exceeded":**
*   DeepSeek often has a hard 128k limit.
*   **Fix:** Run `/context 120k` to leave a safety buffer.
*   **Fix:** Lower the limits: `/outputlimit 2000` and `/toolturn 1`.

**LM Studio Connection Failed:**
*   Ensure LM Studio is running and the "Server" (⚡ icon) is turned ON.
*   Ensure the model loaded supports "Function Calling" (e.g., Qwen 2.5).
