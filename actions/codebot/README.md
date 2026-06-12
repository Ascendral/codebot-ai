# CodeBot AI — GitHub Action

Autonomous AI code review, auto-fix, and security scan for your PRs. Every action is recorded in a hash-chained audit log so you can verify exactly what the agent did.

## Quick Start

### Code review on every PR

```yaml
name: CodeBot Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: codebot-ai/codebot@v1
        with:
          task: review
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Auto-fix and commit

```yaml
name: CodeBot Fix
on:
  workflow_dispatch:
    inputs:
      issue:
        description: 'What to fix'
        required: true

jobs:
  fix:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: codebot-ai/codebot@v1
        with:
          task: fix
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Security scan on push

```yaml
name: CodeBot Security Scan
on: [push]

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: codebot-ai/codebot@v1
        with:
          task: scan
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Inputs

| Input            | Required | Default                    | Description                          |
| ---------------- | -------- | -------------------------- | ------------------------------------ |
| `task`           | ✅       | —                          | `review`, `fix`, or `scan`           |
| `api-key`        | ✅       | —                          | API key for the LLM provider         |
| `provider`       |          | `anthropic`                | `anthropic` or `openai`              |
| `model`          |          | `claude-sonnet-4-20250514` | Model to use                         |
| `policy`         |          | `.codebot/policy.json`     | Path to security policy file         |
| `max-iterations` |          | `25`                       | Max agent loop iterations            |
| `sandbox`        |          | `auto`                     | Sandbox mode: `auto`, `on`, or `off` |

## Supported Providers

| Provider           | Input value | Secret              |
| ------------------ | ----------- | ------------------- |
| Anthropic (Claude) | `anthropic` | `ANTHROPIC_API_KEY` |
| OpenAI (GPT)       | `openai`    | `OPENAI_API_KEY`    |

## Audit Trail

Every run writes a tamper-evident, SHA-256 hash-chained audit log. You can verify it after the fact:

```bash
codebot --verify-audit
codebot --export-audit sarif > results.sarif
```

The audit log is also uploaded as a workflow artifact automatically.

## Security Policy

Create `.codebot/policy.json` to control what the agent is allowed to do:

```json
{
  "rules": [
    { "tool": "execute_command", "permission": "deny", "match": { "command": "rm -rf" } },
    { "tool": "web_fetch", "permission": "allow" }
  ]
}
```

## Local CLI

The same agent runs locally:

```bash
npm install -g codebot-ai
codebot --solve https://github.com/you/repo/issues/42
```

→ [Full documentation](https://github.com/Ascendral/codebot-ai)
