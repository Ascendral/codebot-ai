# Extraction Scope — "Flight Recorder + Policy Gate for AI Agents"

Working name in this doc: **AgentTrail** (placeholder — naming is an open decision).
Scoped against codebot-ai @ v2.10.1, branch `claude/assess-code-bot-ZKFgx`, with
import graphs traced from actual source (not assumed).

---

## Verdict up front

The extraction is **smaller and cleaner than estimated**: ~2,700 lines across
13 modules, **zero external npm dependencies** (Node builtins only), with the
test files coming along for free. The two feared coupling points don't exist:

- `risk.ts` has **zero** codebot references — its `constitutional/types`
  import is **type-only** (vendored as one interface, no runtime dep on CORD)
- `paths.ts` is already env-overridable (`CODEBOT_HOME`) — rename to
  `AGENTTRAIL_HOME`, done
- `sarif.ts` has 3 cosmetic references (a usage comment + 2 `informationUri`
  strings)
- `policy.ts` has 8 references (default deny-paths and doc comments)

## File manifest — what comes out of `src/`

| Module | Lines | Role in new package | Decoupling needed |
|---|---|---|---|
| `audit.ts` | 282 | Hash-chained append-only log (the core asset) | rename paths |
| `policy.ts` | 708 | Policy enforcement (deny paths, tool rules) | 8 refs, trivial |
| `risk.ts` | 513 | 7-factor risk scoring | vendor 1 type |
| `sarif.ts` | 244 | SARIF 2.1.0 export | 3 cosmetic refs |
| `integrity.ts` | 123 | HMAC session integrity | none found yet |
| `capabilities.ts` | 197 | Capability labels + checker | none (imports `path` only) |
| `capability-gating.ts` | 117 | Capability-driven escalation | verify |
| `capability-allowlist.ts` | 119 | `--allow-capability` opt-ins | verify |
| `secrets.ts` | 92 | Secret masking before log write | zero imports |
| `encryption.ts` | 187 | At-rest log encryption | imports `crypto` only |
| `paths.ts` | 22 | Home-dir resolution | rename env var |
| `warn.ts` | 34 | Non-fatal warning channel | zero imports |
| `logger.ts` | 69 | Log plumbing | trivial |
| **Total** | **~2,707** | | |

Plus their `.test.ts` files — audit, policy, risk, sarif, integrity,
capabilities, capability-gating, capability-allowlist, secrets, encryption,
paths all have co-located test suites that transfer with them. The new repo
starts life with several hundred passing tests, not zero.

**What stays behind in codebot-ai:** the agent loop, all 36 tools, providers,
connectors, dashboard, TUI, Electron, vault mode. CodeBot then *consumes* the
extracted package as a dependency — it becomes the reference implementation.

## New code that must be written (the actual work)

### 1. Claude Code hook adapter (~300–500 lines, the MVP centerpiece)

Claude Code supports `PreToolUse` / `PostToolUse` hooks configured in
`settings.json`: the hook command receives tool name + input as JSON on
stdin; a PreToolUse hook can allow/deny/escalate via its JSON response or
exit code. That is exactly a policy-gate + audit-tap insertion point.

CLI verbs for the adapter binary:

```
agenttrail hook pre     # stdin: tool call JSON → policy check + risk score
                        #   → append hash-chained entry → allow/deny response
agenttrail hook post    # stdin: tool result JSON → append completion entry
agenttrail verify [id]  # re-hash the chain, prove no tampering
agenttrail export --sarif [id]
agenttrail init         # writes the hooks block into .claude/settings.json
```

Work items:
- stdin JSON → `AuditEntry` mapping (schema differs from CodeBot's tool calls)
- Claude Code tool names (`Bash`, `Edit`, `Write`, `WebFetch`, …) → capability
  labels (CodeBot's map covers its own 36 tools; need a second map, ~50 lines)
- Response formatting for Claude Code's permission-decision contract
- Latency budget: the hook fires on **every** tool call, so the pre-hook path
  must stay well under ~50 ms (pure-Node hash append: not a concern, but
  measure it, don't assert it)

### 2. The spec document (the strategic asset)

Markdown spec, versioned, in its own repo. Sections:

1. Entry schema (tool, args digest, timestamp, session, sequence, risk score)
2. Chain rule: `hash_n = SHA-256(hash_{n-1} || canonical_json(entry_n))`
3. Canonicalization (JCS or equivalent — needed for cross-implementation verify)
4. Verification algorithm + failure semantics
5. Redaction rules (how masked secrets stay verifiable)
6. Export mappings: SARIF 2.1.0, OpenTelemetry span attributes
7. Conformance levels (log-only / log+verify / log+verify+policy)

The code is the demo; **the spec is what a corp-dev team acquires.**

### 3. Packaging

- New repo (`ascendral/agenttrail` or similar), MIT for the reference
  implementation, spec under CC-BY
- npm package, single binary entry, zero runtime deps (keep it that way —
  it's a security tool; every dep is attack surface and due-diligence drag)
- CI reusing codebot-ai's 3-OS × 3-Node matrix config

### 4. Explicitly NOT in the MVP

- MCP gateway mode (phase 2 — bigger surface, same core)
- Dashboard / web UI (the CLI + SARIF is the product; UI is demo polish later)
- CORD/constitutional enforcement (phase 2 stacking, per the brainstorm)
- Windows-specific hook testing beyond CI (macOS/Linux first)

## Effort estimate (honest)

| Chunk | Estimate |
|---|---|
| Extract 13 modules + tests, rename, new repo green | 2–4 days |
| Hook adapter + tool-name mapping + `init` | 4–7 days |
| Spec v0.1 | 2–3 days |
| Demo: rogue-agent-blocked + chain-verify + SARIF-in-CI GIF | 1–2 days |
| **MVP total** | **~2–3 weeks solo** |

Risks that could stretch it: Claude Code hook response contract details
(verify against current docs at build time, not memory), and canonical-JSON
edge cases in cross-implementation verification.

## 90-day sequence (from the brainstorm, now with real sizes)

1. **Weeks 1–3:** MVP above. Ship = `npm i -g agenttrail && agenttrail init`
   works in any Claude Code repo.
2. **Weeks 3–5:** Spec published + 60-second demo + landing page (reuse
   `landing/` tooling from this repo).
3. **Weeks 5–12:** 3–5 design partners (teams using Claude Code whose
   security lead wants the trail). This is the demand test — if five can't
   be found, the story dies cheap, which is the point of sequencing it here.
4. **Week 12:** decide with evidence: raise / corp-dev conversations / fold
   back into CodeBot.

## Open decisions (Alex's call, not blockers to starting)

1. **Name** — "AgentTrail" is a placeholder; check npm/domain collisions
2. **Repo home** — new org vs `Ascendral/`
3. **Spec governance** — solo-authored v0.1 first; invite co-authors only
   after design partners exist (a spec with users beats a spec with committee)
4. **CodeBot repositioning** — when the package exists, CodeBot's README
   leads with "reference implementation of the <spec name> standard"

---

*Scoped 2026-07-09 by tracing actual import graphs in this working tree.
Line counts from `wc -l`; coupling counts from grep; nothing estimated
from memory.*
