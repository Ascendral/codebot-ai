<div align="center">

# CodeBot AI

### Zero-dependency autonomous AI agent

**Code. Browse. Search. Automate. Audit.**

[![npm version](https://img.shields.io/npm/v/codebot-ai.svg?style=flat-square&color=6366f1)](https://www.npmjs.com/package/codebot-ai)
[![CI](https://github.com/zanderone1980/codebot-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/zanderone1980/codebot-ai/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/codebot-ai.svg?style=flat-square)](https://github.com/zanderone1980/codebot-ai/blob/main/LICENSE)
![tests](https://img.shields.io/badge/tests-1125%20passing-22c55e?style=flat-square)
![dependencies](https://img.shields.io/badge/dependencies-0-22c55e?style=flat-square)
![tools](https://img.shields.io/badge/tools-32-6366f1?style=flat-square)
![node](https://img.shields.io/node/v/codebot-ai.svg?style=flat-square)

```
npm install -g codebot-ai
```

Works with **any LLM** &mdash; Ollama, Claude, GPT, Gemini, DeepSeek, Groq, Mistral, Grok.
<br>Includes web dashboard, VS Code extension, GitHub Action, and enterprise security.

</div>

---

## Install & Run

```bash
# Install globally
npm install -g codebot-ai

# Launch interactive mode
codebot

# Or run without installing
npx codebot-ai
```

First run launches the setup wizard &mdash; pick your model, paste an API key (or use local LLM), done.

```bash
# Local LLM (no API key needed)
ollama pull qwen2.5-coder
codebot --setup       # select "ollama"

# Web dashboard
codebot --dashboard   # opens localhost:3120

# Full autonomous mode
codebot --autonomous "refactor auth module and run tests"
```

---

## What It Does

| Capability | How |
|-----------|-----|
| **Write & edit code** | Reads your codebase, makes targeted edits, runs tests |
| **Run commands** | Shell execution with security filtering and sandbox support |
| **Browse the web** | Controls Chrome via DevTools Protocol &mdash; navigate, click, type, screenshot |
| **Search the internet** | Real-time web search for docs, APIs, current info |
| **Web dashboard** | Sessions, audit trail, metrics, and Command Center at localhost:3120 |
| **Schedule routines** | Cron-based recurring tasks &mdash; monitoring, reports, automation |
| **Persistent memory** | Remembers preferences and context across sessions |
| **Enterprise security** | RBAC policies, risk scoring, encrypted audit trail, SARIF export |

---

## Web Dashboard

Launch with `codebot --dashboard` or standalone with `npx codebot-ai && open http://localhost:3120`.

<!-- Add screenshots: save to docs/images/ and uncomment
![Dashboard Sessions](docs/images/dashboard-sessions.png)
![Dashboard Metrics](docs/images/dashboard-metrics.png)
![Dashboard Command Center](docs/images/dashboard-command.png)
-->

**Sessions** &mdash; Browse and inspect every conversation with message counts and timestamps.

**Audit Trail** &mdash; Cryptographic hash-chained log of every tool execution. One-click chain verification.

**Metrics** &mdash; Session counts, audit events, tool usage breakdown, and activity charts.

**Command Center** &mdash; Interactive terminal, quick actions (git status, run tests, health check), and when connected to the agent: AI chat and tool runner.

---

## 8 LLM Providers

| Provider | Models |
|----------|--------|
| **Local (Ollama/LM Studio/vLLM)** | qwen2.5-coder, qwen3, deepseek-coder, llama3.x, mistral, phi-4, codellama, starcoder2 |
| **Anthropic** | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5 |
| **OpenAI** | gpt-4o, gpt-4.1, o1, o3, o4-mini |
| **Google** | gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash |
| **DeepSeek** | deepseek-chat, deepseek-reasoner |
| **Groq** | llama-3.3-70b, mixtral-8x7b |
| **Mistral** | mistral-large, codestral |
| **xAI** | grok-3, grok-3-mini |

```bash
export ANTHROPIC_API_KEY="sk-ant-..."    # or any provider
codebot --model claude-sonnet-4-6
```

Or use a local model with zero API keys:
```bash
ollama pull qwen2.5-coder && codebot --provider ollama --model qwen2.5-coder
```

---

## 32 Built-in Tools

| Tool | Permission | Description |
|------|:----------:|-------------|
| `read_file` | auto | Read files with line numbers |
| `write_file` | prompt | Create or overwrite files (undo snapshots) |
| `edit_file` | prompt | Find-and-replace edits with diff preview |
| `batch_edit` | prompt | Multi-file atomic find-and-replace |
| `execute` | always-ask | Run shell commands (security-filtered) |
| `glob` | auto | Find files by pattern |
| `grep` | auto | Search file contents with regex |
| `git` | prompt | Git operations (status, diff, log, commit, branch) |
| `browser` | prompt | Chrome automation via CDP |
| `web_fetch` | prompt | HTTP requests and API calls |
| `web_search` | prompt | Internet search with summaries |
| `think` | auto | Internal reasoning scratchpad |
| `memory` | auto | Persistent memory across sessions |
| `routine` | prompt | Schedule recurring tasks with cron |
| `code_analysis` | auto | Symbol extraction, imports, outline |
| `code_review` | auto | Security scanning and complexity analysis |
| `multi_search` | auto | Fuzzy search: filenames, content, symbols |
| `task_planner` | auto | Hierarchical task tracking |
| `diff_viewer` | auto | File comparison and git diffs |
| `test_runner` | prompt | Auto-detect and run tests (jest, vitest, pytest, go, cargo) |
| `docker` | prompt | Container management (ps, run, build, compose) |
| `database` | prompt | Query SQLite databases (blocks destructive SQL) |
| `http_client` | prompt | Advanced HTTP with auth and headers |
| `image_info` | auto | Image dimensions and metadata |
| `pdf_extract` | auto | Extract text and metadata from PDFs |
| `ssh_remote` | always-ask | Remote command execution via SSH |
| `notification` | prompt | Webhook notifications (Slack, Discord) |
| `package_manager` | prompt | Dependency management (npm, yarn, pip, cargo, go) |
| `app_connector` | prompt | GitHub, Jira, Linear, Slack integrations |
| `graphics` | prompt | Image processing: resize, crop, watermark, convert |
| `delegate` | prompt | Multi-agent task delegation |

**Permission levels:** `auto` = runs silently, `prompt` = asks first (skipped in `--autonomous`), `always-ask` = always confirms.

---

## App Connectors

Connect to external services with OAuth or API keys:

| Connector | Capabilities |
|-----------|-------------|
| **GitHub** | Issues, PRs, repos, code search |
| **Jira** | Issues, projects, sprints, transitions |
| **Linear** | Issues, projects, teams, cycles |
| **Slack** | Messages, channels, users, threads |
| **OpenAI Images** | DALL-E generation, editing, variations |
| **Replicate** | Run any ML model via API |

Credentials stored in encrypted vault (AES-256-GCM).

---

## Security

Built for enterprise from day one:

```
 Risk Scoring       6-factor risk scoring on every tool call (0-100)
 Encryption         AES-256-GCM encryption at rest
 Audit Trail        SHA-256 hash-chained, tamper-evident logs
 Sandbox            Docker-based execution with network/CPU/memory limits
 RBAC               Declarative JSON policy engine with per-tool permissions
 SARIF Export       GitHub Code Scanning integration
 SSRF Protection    Blocks localhost, private IPs, cloud metadata
 Secret Detection   15+ patterns (AWS keys, tokens, private keys)
 Path Safety        Blocks writes to system directories
 Session Integrity  HMAC-based tamper detection
```

See [SECURITY.md](SECURITY.md) for the full model.

---

## CLI Reference

```bash
codebot                                        # Interactive REPL
codebot "fix the bug in app.ts"                # Single task
codebot --autonomous "refactor auth and test"  # Full auto
codebot --continue                             # Resume last session
codebot --dashboard                            # Web dashboard
codebot --tui                                  # Terminal UI (panels)
codebot --doctor                               # Environment health check
echo "explain this error" | codebot            # Pipe mode
```

<details>
<summary><strong>All CLI flags</strong></summary>

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
--tui                Full terminal UI mode
--dashboard          Web dashboard on localhost:3120
--doctor             Environment health checks
--theme <name>       Color theme: dark, light, mono
--no-animate         Disable animations
--no-stream          Disable streaming display
--verbose            Debug output
```

</details>

<details>
<summary><strong>Interactive commands</strong></summary>

```
/help       Show commands           /model     Show or change model
/models     List supported models   /sessions  List saved sessions
/routines   List routines           /auto      Toggle autonomous mode
/undo       Undo last edit          /usage     Token usage
/clear      Clear conversation      /compact   Force context compaction
/metrics    Session metrics         /risk      Risk assessment history
/config     Show configuration      /doctor    Health checks
/toolcost   Per-tool cost breakdown /rate      Rate limit status
/theme      Switch color theme      /quit      Exit
```

</details>

---

## VS Code Extension

```bash
code --install-extension codebot-ai-vscode-2.0.0.vsix
```

Sidebar chat panel, inline diff preview, status bar (tokens, cost, risk level), theme integration.

## GitHub Action

```yaml
- uses: zanderone1980/codebot-ai/actions/codebot@v2
  with:
    task: review    # or: fix, scan
    api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Programmatic API

```typescript
import { Agent, AnthropicProvider } from 'codebot-ai';

const agent = new Agent({
  provider: new AnthropicProvider({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-6',
  }),
  model: 'claude-sonnet-4-6',
  autoApprove: true,
});

for await (const event of agent.run('list all TypeScript files')) {
  if (event.type === 'text') process.stdout.write(event.text || '');
}
```

## Plugins & MCP

**Custom tools:** Drop `.js` files in `.codebot/plugins/`:

```javascript
module.exports = {
  name: 'my_tool',
  description: 'Does something useful',
  permission: 'prompt',
  parameters: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] },
  execute: async (args) => `Result: ${args.input}`,
};
```

**MCP servers:** Create `.codebot/mcp.json`:

```json
{
  "servers": [{ "name": "my-server", "command": "npx", "args": ["-y", "@my/mcp-server"] }]
}
```

---

## Build from Source

```bash
git clone https://github.com/zanderone1980/codebot-ai.git
cd codebot-ai
npm install && npm run build
./bin/codebot
```

## Stability

- **Auto-retry** &mdash; exponential backoff on network errors, rate limits, server errors
- **Stream recovery** &mdash; reconnects if the LLM drops mid-response
- **Context compaction** &mdash; smart summarization when hitting context limits
- **Process resilience** &mdash; catches unhandled exceptions, keeps the REPL running
- **1125 tests** &mdash; comprehensive coverage across agent, tools, security, and dashboard

---

<div align="center">

**[npm](https://www.npmjs.com/package/codebot-ai)** &middot; **[GitHub](https://github.com/zanderone1980/codebot-ai)** &middot; **[Changelog](CHANGELOG.md)** &middot; **[Roadmap](ROADMAP.md)** &middot; **[Security](SECURITY.md)**

MIT &mdash; [Ascendral Software Development & Innovation](https://github.com/AscendralSoftware)

</div>
