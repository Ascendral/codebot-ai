# CodeBot AI — Roadmap

**Philosophy:** Ship something hardened at every checkpoint. No big bangs.

---

## Current State (v2.1.6) — SHIPPED

| Metric | Value |
|--------|-------|
| Version | 2.2.0 |
| Tests | 907 passing |
| Tools | 28 built-in + MCP + plugins |
| Security | 8-layer stack: policy, RBAC, capabilities, risk scoring, path safety, secret detection, SSRF, sandbox |
| Platforms | CLI, VS Code extension, GitHub Action |
| npm | [codebot-ai@2.1.6](https://www.npmjs.com/package/codebot-ai) |

### Completed Milestones

| Version | Codename | Key Deliverable | Tests | Status |
|---------|----------|-----------------|-------|--------|
| v1.0.0 | Genesis | Core agent, 10 tools, 8 providers | 54 | Shipped |
| v1.1.0 | Extended | Diff preview, undo, batch edit, plugins, MCP | 83 | Shipped |
| v1.5.0 | Performance | Parallel execution, caching, rate limiting | 148 | Shipped |
| v1.6.0 | Hardened | Security foundations (path safety, secrets, audit, SSRF) | 217 | Shipped |
| v1.7.0 | Contained | Docker sandbox, policy engine, hash-chained audit, replay | 260 | Shipped |
| v1.8.0 | Trustworthy | Capabilities, session integrity (HMAC), git workflow, cost tracking | 307 | Shipped |
| v1.9.0 | Observable | Structured metrics, risk scoring, SARIF export | 376 | Shipped |
| v2.0.0 | Enterprise | VS Code extension, GitHub Action, docs, legal | 483 | Shipped |
| v2.1.0 | RBAC | RBAC sweep, encryption at rest, ESLint | 491 | Shipped |
| v2.1.3 | Animation | Terminal animation system, mascot, boot sequence | 491 | Shipped |
| v2.1.5 | Hardened II | RBAC consistency, browser safety, encryption wiring | 559 | Shipped |
| v2.1.6 | Intelligence | Prompt caching, vision/multimodal, model routing, JSON mode | 586 | Shipped |
| v2.2.0 | Quality | 907 tests, CLI UI polish, permission cards, cost estimation, browser resilience | 907 | Shipped |

---

## Shipped: v2.2.0 — Quality and UX

**Theme:** Make it feel production-grade.

**Target:** March 2026

### Completed (v2.2.0-alpha)
- 880 comprehensive tests (every tool has a dedicated test file)
- Premium CLI output: UI component library (boxes, risk bars, spinners, diff previews)
- Permission cards: bordered cards with risk bar, sandbox/network status, approve/deny
- --verbose flag for detailed output
- Boxed session summary with risk average
- README overhaul: comparison table, badges, troubleshooting, security summary
- Multi-agent orchestration (parent/child delegation)

### Completed (v2.2.0)
- ✅ Cost transparency: --dry-run / --estimate flags for cost prediction
- ✅ Browser resilience: auto-reconnect on WebSocket drop, fetch-only fallback
- ✅ CHANGELOG update for v2.2.0 release
- ⏳ Per-tool cost breakdown in session metrics (deferred to v2.3.0)
- ⏳ codebot doctor: environment health check (deferred to v2.3.0)

### Gate Criteria
- 907 tests, 0 failures ✅
- Clean npm run build
- All tools have dedicated test files
- README renders correctly on GitHub

---

## Next: v2.3.0 — Platform

**Theme:** Run anywhere, for anyone.

**Target:** Q2 2026

### TUI Mode
- Full terminal UI with plan/logs/diff panels
- Interactive step list with approve/retry/skip
- Real-time progress with spinners and timing

### CLI Enhancements
- Progress UI with spinners and timing per step
- Diff preview before write operations (approve/deny/edit scope)
- Collapsible verbose sections
- Theme presets (dark, light, mono)

### Web Dashboard (Local)
- Session history with timestamps and outcomes
- Per-run view: plan, approvals, tool calls, diffs, artifacts
- Audit chain viewer with export button

### Enhanced Providers
- Provider-aware rate limiting
- Streaming response display (token-by-token)
- Cost budget visualization

### Gate Criteria
- TUI prototype working
- Web dashboard serving locally
- 900+ tests

---

## v2.4.0 — Teams and Ecosystem

**Theme:** Scale beyond a single developer.

**Target:** Q3 2026

### Team Policies
- Organization-level policy inheritance (org, team, project)
- Shared policy repository via git
- Policy validation CLI

### Plugin Marketplace
- Community plugin registry (searchable, versioned)
- MCP server discovery
- One-click install
- Plugin security audit (dependency scan, permission review)

### REST API
- Server mode (codebot --serve)
- REST API with OpenAPI spec
- Webhook integrations (Slack, Discord, Teams)

---

## What We Are NOT Building (Scope Control)

Explicitly out of scope:

- Desktop app (Electron/Tauri) — CLI + VS Code is sufficient
- Cloud hosted version — self-hosted only
- Billing/subscription system
- Mobile app
- Proprietary license — staying MIT

---

## Competitive Position

**The secure, self-hosted AI engineering platform.**

The only open-source AI coding agent that is:
- **Secure by default** — 8-layer security stack
- **Auditable** — hash-chained SARIF-exportable audit trail
- **Policy-driven** — declarative JSON security policies
- **Provider-agnostic** — any LLM, local or cloud
- **Zero dependencies** — pure Node.js, no install bloat
- **Enterprise-ready** — VS Code extension, GitHub Action, CI/CD integration
- **Tested** — 880+ tests covering every tool and security boundary
