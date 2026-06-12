<div align="center">

# CodeBot AI

**Open-source autonomous coding agent with a cryptographic audit trail.**

For work you want to _delegate_, not just _assist_ with — and verify after the fact.

[![npm version](https://img.shields.io/npm/v/codebot-ai.svg?style=flat-square&color=6366f1)](https://www.npmjs.com/package/codebot-ai)
[![license](https://img.shields.io/npm/l/codebot-ai.svg?style=flat-square)](https://github.com/Ascendral/codebot-ai/blob/main/LICENSE)
![tests](https://img.shields.io/badge/tests-2218%20passing-22c55e?style=flat-square)

</div>

---

## What CodeBot is

CodeBot runs coding tasks end-to-end. Point it at a GitHub issue, a problem statement, or a spec — it reads the repo, makes the changes, runs the tests, and opens a PR. Every tool call it makes (every file it touches, every command it runs, every URL it fetches) is recorded in a SHA-256 hash-chained audit log. Tamper with the log, the chain breaks, you know.

It runs against the LLM _you_ pick — local Ollama / LM Studio / vLLM, or any of eight cloud providers — through _your_ API key, on _your_ endpoint. Zero telemetry by default. MIT. Air-gapped if you want.

## What CodeBot is NOT

CodeBot is not an AI-powered editor. Cursor, Zed, and VS Code with Copilot already own that category. If you want Tab-completion and inline suggestions while you type, one of those is a better fit — CodeBot won't try to compete.

CodeBot is for the class of work that starts with _"hey agent, go do this while I'm not watching"_ and ends with someone — maybe you, maybe your auditor — needing to know exactly what got done.

## Who it's for

- **Security-conscious engineering teams** that can't send code to third-party AI services but still want agent-level automation.
- **Regulated industries** (fintech, healthcare, gov-adjacent) that need an auditable paper trail for every AI action.
- **Solo builders and small teams** running AI on long-running tasks who need to verify results later.
- **Anyone who wants their AI agent to run Ollama, not send code to an API they don't control.**

## Quick Start

```bash
npm install -g codebot-ai

# If you have an API key in your environment, just run:
codebot "explain what this project does"   # reads code, asks before writing

# No API key yet? Run the setup wizard (auto-detects Ollama, LM Studio, cloud keys):
codebot --setup

# Run a task hands-free — no permission prompts:
codebot --autonomous "add error handling to src/server.ts"

# Or set it once in your shell profile:
export CODEBOT_AUTO_APPROVE=true

# Web dashboard:
codebot --dashboard

# Solve a GitHub issue end-to-end (autonomous by default):
codebot --solve https://github.com/you/repo/issues/42
```

Supported API keys (set whichever you have): `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `XAI_API_KEY`. CodeBot auto-detects which one is set.

## Hero workflow — `--solve`

Point CodeBot at a GitHub issue and walk away:

```
codebot --solve https://github.com/you/repo/issues/42
```

An 8-phase pipeline runs autonomously:

1. **Parse** — extract requirements from the issue
2. **Clone** — shallow-clone the target repo
3. **Analyze** — map the codebase, locate relevant files
4. **Install** — detect package manager, install deps
5. **Fix** — apply code changes guided by the issue
6. **Test** — run the suite, iterate until green
7. **Self-review** — audit the diff for regressions
8. **PR** — open a pull request with the audit trail attached

Every phase writes to the hash-chained log. If the agent does anything unexpected, you can prove it after the fact.

**What it looks like:**

```
$ codebot --solve https://github.com/acme/api/issues/142

  CodeBot AI — Issue Solver

  ⠹  parsing      Parsing issue URL...
  ✓  fetching     "Fix: null pointer in /users/:id endpoint"
  ✓  cloning      acme/api → /tmp/codebot-solve-a3f2/
  ✓  analyzing    TypeScript, Jest, 47 files
  ✓  installing   npm ci (12.4s)
  ✓  fixing       src/routes/users.ts, src/middleware/auth.ts
  ✓  testing      Jest: 143 passed, 0 failed
  ✓  reviewing    Self-review: approve (confidence 94%)
  ✓  committing   Branch: codebot/fix-users-null-pointer

  ══════════════════════════════════════════════
  SOLVE RESULT
  ══════════════════════════════════════════════
  Session:    1746812034-x7k2p
  Issue:      #142 "Fix: null pointer in /users/:id endpoint"
  Branch:     codebot/fix-users-null-pointer
  Files:      2 changed
              - src/routes/users.ts
              - src/middleware/auth.ts
  Tests:      PASSED
  Confidence: 94%
  Duration:   87.3s
  Cost:       $0.23
  Audit:      47 actions recorded — ~/.codebot/solve-audits/solve-142-....json
  Chain:      ✓ verified (52 entries, hash chain intact)
  ══════════════════════════════════════════════
```

The audit log is a tamper-evident SHA-256 hash-chained record of every file read, every line written, every command run. Export it as SARIF for your compliance toolchain:

```bash
codebot --export-audit sarif > codebot-audit.sarif
```

## Second workflow — `--vault` (research assistant over your notes)

Point CodeBot at a folder of markdown notes and ask questions:

```bash
codebot --vault ~/Documents/my-notes "what did I capture about Q3 strategy?"
```

CodeBot reads your notes, synthesizes an answer, and **cites the files it actually consulted**. Read-only by default — it won't edit or create anything. No network calls unless you opt in. Every file it opens goes into the same hash-chained audit log: you can prove exactly which notes the AI touched.

```bash
# Interactive mode — open a session over the vault and ask follow-ups
codebot --vault ~/Documents/my-notes

# Allow CodeBot to create or edit notes when you ask it to
codebot --vault ~/Documents/my-notes --vault-writable

# Allow outbound web_fetch / http_client when you want it to look something up
codebot --vault ~/Documents/my-notes --vault-allow-network
```

Works with any markdown folder — Obsidian vaults, plain `~/notes`, dumped Evernote exports. `.obsidian/`, `.git/`, and `node_modules/` are automatically skipped.

## GitHub Action — CI/CD integration

Run CodeBot in any GitHub workflow. Code review on every PR, auto-fix on demand, security scan on push — all with a tamper-evident audit trail:

```yaml
- uses: codebot-ai/codebot@v1
  with:
    task: review # or: fix, scan
    api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

→ [Full GitHub Action documentation](actions/codebot/README.md)

## How CodeBot differs

|                                     | Cursor / Copilot |  Aider  |  Devin  |  **CodeBot**   |
| ----------------------------------- | :--------------: | :-----: | :-----: | :------------: |
| Autonomous issue-to-PR              |        No        | Partial |   Yes   |    **Yes**     |
| Cryptographic audit trail           |        No        |   No    |   No    |    **Yes**     |
| Local LLM supported                 |        No        |   Yes   |   No    |    **Yes**     |
| Policy + risk-scoring layer         |        No        |   No    | Partial |    **Yes**     |
| SARIF export for CI                 |        No        |   No    |   No    |    **Yes**     |
| MIT-licensed / open source          |        No        |   Yes   |   No    |    **Yes**     |
| Runs fully offline (with local LLM) |        No        |   Yes   |   No    |    **Yes**     |
| Price                               |      $20/mo      |  Free   | $500/mo | **Free / MIT** |

## Three pillars

### 1. Autonomous, not interactive

CodeBot takes a task and finishes it. No inline suggestions, no "accept completion." You hand it a goal; it runs the loop (read → plan → edit → test → review) until done or explicitly stopped. Iteration budget, timeout, and max-cost are all configurable.

### 2. Cryptographic audit trail

Every tool call is logged as an append-only entry containing `prevHash` + content, hashed with SHA-256. Tampering breaks the chain. Entries include the tool name, arguments, return value size, timestamp, session ID, and 7-factor risk score. Export to SARIF 2.1.0 for CI integration.

Run `codebot audit verify <session-id>` any time to re-hash and prove the log hasn't been modified.

### 3. Runs where your code can't leave

Eight providers: Ollama / LM Studio / vLLM (fully local, offline-capable) and Anthropic / OpenAI / Google / DeepSeek / Groq / Mistral / xAI (cloud, your keys). No CodeBot-hosted relay. No opt-in-required telemetry (the heartbeat ping is off by default and won't turn itself on). Works on an air-gapped network with a local LLM.

## Real benchmark

**SWE-bench Verified, 50-task slice, Docker-scored**: 24 tasks resolved unattended (48.0% over attempted, 61.5% over submitted patches). Reproducible, official harness, in `bench/swe/`. [Full report](docs/benchmarks/swe-bench-verified-2026-04-17-50tasks-v2.md).

This is a ceiling number, not a growth number — what it proves is that the agent loop genuinely works end-to-end, not just in demos.

## Architecture

```
User → Agent Loop → Policy Enforcer → Risk Scorer → CORD Safety Engine → Tool Executor
             ↓              ↓              ↓                 ↓                ↓
       8 providers   Denied paths    7 factors       Constitutional     36 tools
       (local+cloud)  Writable scope  (0-100 score)   rules + VIGIL    (code, shell,
                                                                        browser, git…)
             ↓
      Hash-chained audit log (SARIF export) ─────→ every call, always
```

## Extend

```typescript
import { Agent, OpenAIProvider } from 'codebot-ai';

const agent = new Agent({
  provider: new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-5.4',
  }),
  model: 'gpt-5.4',
  autoApprove: true,
});

for await (const event of agent.run('list all TypeScript files and count them')) {
  if (event.type === 'text') process.stdout.write(event.text || '');
}
```

Custom tools via `.codebot/plugins/` · MCP servers via `.codebot/mcp.json` · [VS Code extension](extensions/vscode) · [GitHub Action](actions/codebot)

## The honest limits

- **Not a Cursor replacement.** No tab-completion, no inline suggestions, no in-editor UX.
- **Autonomous ≠ perfect.** SWE-bench Verified pass rate is 48% unattended. Humans still need to review PRs.
- **Local LLM quality is LLM-dependent.** A 7B model won't solve what gpt-5.4 solves. You pick the tradeoff.
- **Policy enforcement is safety, not a guarantee.** CORD + risk scoring reduce the blast radius of agent mistakes; they don't eliminate them. Use git, use branches, use CI.

---

<div align="center">

**[Docs](docs/)** · **[Changelog](CHANGELOG.md)** · **[Security](SECURITY.md)** · **[Compliance](docs/COMPLIANCE.md)** · **[Contributing](CONTRIBUTING.md)**

MIT — [Ascendral](https://github.com/Ascendral)

</div>
