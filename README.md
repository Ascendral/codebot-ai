# CodeBot AI

[![npm version](https://img.shields.io/npm/v/codebot-ai.svg)](https://www.npmjs.com/package/codebot-ai)
[![license](https://img.shields.io/npm/l/codebot-ai.svg)](https://github.com/zanderone1980/codebot-ai/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/codebot-ai.svg)](https://nodejs.org)

**Zero-dependency autonomous AI agent.** Works with any LLM — local or cloud. Code, browse the web, run commands, search, automate routines, and more.

Built by [Ascendral Software Development & Innovation](https://github.com/AscendralSoftware).

## Quick Start

```bash
npm install -g codebot-ai
codebot
```

That's it. The setup wizard launches on first run — pick your model, paste an API key (or use a local LLM), and you're coding.

```bash
# Or run without installing
npx codebot-ai
```

## What Can It Do?

- **Write & edit code** — reads your codebase, makes targeted edits, runs tests
- **Run shell commands** — system checks, builds, deploys, git operations
- **Browse the web** — navigates Chrome, clicks, types, reads pages, takes screenshots
- **Search the internet** — real-time web search for docs, APIs, current info
- **Automate routines** — schedule recurring tasks with cron (daily posts, email checks, monitoring)
- **Call APIs** — HTTP requests to any REST endpoint
- **Persistent memory** — remembers preferences and context across sessions
- **Self-recovering** — retries on network errors, recovers from API failures, never drops out

## Supported Models

Pick any model during setup. CodeBot works with all of them:

| Provider | Models |
|----------|--------|
| **Local (Ollama/LM Studio/vLLM)** | qwen2.5-coder, qwen3, deepseek-coder, llama3.x, mistral, phi-4, codellama, starcoder2, and any model your server runs |
| **Anthropic** | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5 |
| **OpenAI** | gpt-4o, gpt-4.1, o1, o3, o4-mini |
| **Google** | gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash |
| **DeepSeek** | deepseek-chat, deepseek-reasoner |
| **Groq** | llama-3.3-70b, mixtral-8x7b |
| **Mistral** | mistral-large, codestral |
| **xAI** | grok-3, grok-3-mini |

For local models, just have Ollama/LM Studio/vLLM running — CodeBot auto-detects them.

For cloud models, set an environment variable:

```bash
export OPENAI_API_KEY="sk-..."           # GPT
export ANTHROPIC_API_KEY="sk-ant-..."    # Claude
export GEMINI_API_KEY="..."              # Gemini
export DEEPSEEK_API_KEY="sk-..."         # DeepSeek
export GROQ_API_KEY="gsk_..."            # Groq
export MISTRAL_API_KEY="..."             # Mistral
export XAI_API_KEY="xai-..."             # Grok
```

Or paste your key during setup — either way works.

## Usage

```bash
codebot                                        # Interactive REPL
codebot "fix the bug in app.ts"                # Single task
codebot --autonomous "refactor auth and test"  # Full auto — no permission prompts
codebot --continue                             # Resume last session
echo "explain this error" | codebot            # Pipe mode
```

### CLI Options

```
--setup              Run the setup wizard
--model <name>       Model to use
--provider <name>    Provider: openai, anthropic, gemini, deepseek, groq, mistral, xai
--base-url <url>     LLM API base URL
--api-key <key>      API key (or use env vars)
--autonomous         Skip all permission prompts
--resume <id>        Resume a session by ID
--continue, -c       Resume the most recent session
--max-iterations <n> Max agent loop iterations (default: 50)
```

### Interactive Commands

```
/help       Show commands
/model      Show or change model
/models     List all supported models
/sessions   List saved sessions
/routines   List scheduled routines
/auto       Toggle autonomous mode
/undo       Undo last file edit (/undo [path])
/usage      Show token usage for this session
/clear      Clear conversation
/compact    Force context compaction
/config     Show configuration
/quit       Exit
```

## Tools

CodeBot has 13 built-in tools:

| Tool | Description | Permission |
|------|-------------|-----------|
| `read_file` | Read files with line numbers | auto |
| `write_file` | Create or overwrite files (with undo snapshots) | prompt |
| `edit_file` | Find-and-replace edits with diff preview + undo | prompt |
| `batch_edit` | Multi-file atomic find-and-replace | prompt |
| `execute` | Run shell commands | always-ask |
| `glob` | Find files by pattern | auto |
| `grep` | Search file contents with regex | auto |
| `think` | Internal reasoning scratchpad | auto |
| `memory` | Persistent memory across sessions | auto |
| `web_fetch` | HTTP requests and API calls | prompt |
| `web_search` | Internet search with result summaries | prompt |
| `browser` | Chrome automation via CDP | prompt |
| `routine` | Schedule recurring tasks with cron | prompt |

### Permission Levels

- **auto** — Runs without asking
- **prompt** — Asks for approval (skipped in `--autonomous` mode)
- **always-ask** — Always asks, even in autonomous mode

### Browser Automation

Controls Chrome via the Chrome DevTools Protocol. Actions:

- `navigate` — Go to a URL
- `content` — Read page text
- `screenshot` — Capture the page
- `click` — Click an element by CSS selector
- `find_by_text` — Find and interact with elements by visible text
- `type` — Type into an input field
- `scroll`, `press_key`, `hover` — Page interaction
- `evaluate` — Run JavaScript on the page
- `tabs` — List open tabs
- `close` — Close browser connection

Chrome is auto-launched with `--remote-debugging-port` if not already running.

### Routines & Scheduling

Schedule recurring tasks with cron expressions:

```
> Set up a routine to check my server health every hour
> Create a daily routine at 9am to summarize my GitHub notifications
```

CodeBot creates the cron schedule, and the built-in scheduler runs tasks automatically while the agent is active. Manage with `/routines`.

### Memory

Persistent memory that survives across sessions:

- **Global memory** (`~/.codebot/memory/`) — preferences, patterns
- **Project memory** (`.codebot/memory/`) — project-specific context
- Automatically injected into the system prompt
- The agent reads/writes its own memory to learn your style

### Plugins

Extend CodeBot with custom tools. Drop `.js` files in `.codebot/plugins/` (project) or `~/.codebot/plugins/` (global):

```javascript
// .codebot/plugins/my-tool.js
module.exports = {
  name: 'my_tool',
  description: 'Does something useful',
  permission: 'prompt',
  parameters: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] },
  execute: async (args) => { return `Result: ${args.input}`; }
};
```

### MCP Servers

Connect external tool servers via [Model Context Protocol](https://modelcontextprotocol.io). Create `.codebot/mcp.json`:

```json
{
  "servers": [
    {
      "name": "my-server",
      "command": "npx",
      "args": ["-y", "@my/mcp-server"],
      "env": {}
    }
  ]
}
```

MCP tools appear automatically with the `mcp_<server>_<tool>` prefix.

## Stability

CodeBot v1.3.0 is hardened for continuous operation:

- **Automatic retry** — network errors, rate limits (429), and server errors (5xx) retry with exponential backoff
- **Stream recovery** — if the LLM connection drops mid-response, the agent loop retries on the next iteration
- **Context compaction** — when the conversation exceeds the model's context window, messages are intelligently summarized
- **Process resilience** — unhandled exceptions and rejections are caught, logged, and the REPL keeps running
- **Routine timeouts** — scheduled tasks are capped at 5 minutes to prevent the scheduler from hanging
- **99 tests** — comprehensive suite covering error recovery, retry logic, tool execution, and edge cases

## Programmatic API

CodeBot can be used as a library:

```typescript
import { Agent, OpenAIProvider, AnthropicProvider } from 'codebot-ai';

const provider = new AnthropicProvider({
  baseUrl: 'https://api.anthropic.com',
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-6',
});

const agent = new Agent({
  provider,
  model: 'claude-sonnet-4-6',
  autoApprove: true,
});

for await (const event of agent.run('list all TypeScript files')) {
  if (event.type === 'text') process.stdout.write(event.text || '');
}
```

## Architecture

```
src/
  agent.ts              Agent loop — streaming, tool execution, error recovery
  cli.ts                CLI interface, REPL, slash commands
  types.ts              TypeScript interfaces
  parser.ts             XML/JSON tool call parser (for models without native tool support)
  history.ts            Session persistence (JSONL)
  memory.ts             Persistent memory system
  setup.ts              Interactive setup wizard (model-first UX)
  scheduler.ts          Cron-based routine scheduler
  retry.ts              Exponential backoff with jitter
  context/
    manager.ts          Context window management, LLM-powered compaction
    repo-map.ts         Project structure scanner
  providers/
    openai.ts           OpenAI-compatible provider (covers most cloud APIs)
    anthropic.ts        Native Anthropic Messages API provider
    registry.ts         Model registry, provider detection
  browser/
    cdp.ts              Chrome DevTools Protocol client (zero-dep WebSocket)
  plugins.ts            Plugin loader (.codebot/plugins/)
  mcp.ts                MCP (Model Context Protocol) client
  tools/
    read.ts, write.ts, edit.ts, execute.ts
    batch-edit.ts       Multi-file atomic editing
    glob.ts, grep.ts, think.ts
    memory.ts, web-fetch.ts, web-search.ts
    browser.ts, routine.ts
```

## Configuration

Config is loaded in this order (later values win):

1. `~/.codebot/config.json` (saved by setup wizard)
2. Environment variables (`CODEBOT_MODEL`, `CODEBOT_PROVIDER`, etc.)
3. CLI flags (`--model`, `--provider`, etc.)

## From Source

```bash
git clone https://github.com/zanderone1980/codebot-ai.git
cd codebot-ai
npm install && npm run build
./bin/codebot
```

## License

MIT - [Ascendral Software Development & Innovation](https://github.com/AscendralSoftware)
