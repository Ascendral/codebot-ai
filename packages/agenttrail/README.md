# agenttrail

**Tamper-evident flight recorder + policy gate for AI agents.**

Every action an agent takes — logged in a SHA-256 hash-chained, append-only
audit trail. Tamper with the log, the chain breaks, you know. Policy
enforcement and 7-factor risk scoring gate actions *before* they run.
SARIF 2.1.0 export feeds CI and SIEM.

Zero runtime dependencies. MIT.

## Status — pre-release (v0.1.0), validated against live Claude Code

First real-world validation 2026-07-09: Claude Code v2.1.34 on macOS
(arm64), OAuth session, `agenttrail init` + a 4-tool-call task →

```
$ agenttrail sessions
cc-f437b8aa-e147-4216-8a8f-e44edbb0496b	4 entries
$ agenttrail verify
VALID   cc-f437b8aa-e147-4216-8a8f-e44edbb0496b  (4 entries)
```

The bin-shim bug that dogfood run caught is fixed and regression-tested
(`bin.test.ts` spawns the real binary).

Extracted from [codebot-ai](https://github.com/Ascendral/codebot-ai)'s
production audit/policy layer (shipped across 20 versions, exercised by its
1,979-test suite). This package's own suite: **251 tests / 51 suites,
passing**.

What works today (verified, not asserted):

```
$ node --test dist/*.test.js
# tests 251 / # pass 251 / # fail 0

$ agenttrail init          # wires hooks into ./.claude/settings.json
$ # ... a Claude Code session runs; every tool call chains to the log ...
$ agenttrail verify
VALID   cc-demo42  (3 entries)
$ sed -i 's/npm test/rm -rf ~/' ~/.agenttrail/audit/*.jsonl   # attacker edits log
$ agenttrail verify
BROKEN  cc-demo42  (1 entries)  Hash mismatch at sequence 1: expected 75fd6858..., got e8184dcf...
$ echo $?
1
```

Not built yet (see roadmap): the log-format spec document, npm publication.

## Claude Code integration

```bash
cd your-repo
agenttrail init
```

That writes PreToolUse/PostToolUse hooks into `.claude/settings.json`.
From then on, every tool call in every Claude Code session in that repo is:

1. **Recorded** to the hash chain (tool, sanitized args, risk score, labels)
2. **Risk-scored** (0–100, 6 factors) and capability-labeled
3. **Policy-checked** — a project `.agenttrail/policy.json` can disable
   tools or deny write paths; violations return a `deny` decision to
   Claude Code and land on the chain as `policy_block`

Intervention philosophy: **observe everything, intervene rarely.** The
hook never emits "allow" — Claude Code's own permission flow stays the
primary gate. It only speaks up to deny (policy violation, prohibited
capability) or ask (always-ask capability, red risk score).

Hooks run as one process per tool call; the chain resumes from disk each
time (`AuditLogger.resume`), so a whole session still verifies as one
unbroken chain.

## API

```typescript
import { AuditLogger, PolicyEnforcer, RiskScorer, exportSarif } from 'agenttrail';

const audit = new AuditLogger();                       // ~/.agenttrail/audit/*.jsonl
audit.log({ tool: 'execute', action: 'execute', args: { command: 'npm test' } });

audit.verifySession();                                 // { valid: true, entriesChecked: n }
// → any byte modified in the log: { valid: false, firstInvalidAt, reason }

const sarif = exportSarif(entries);                    // SARIF 2.1.0 for CI upload
```

Also exported: session HMAC integrity (`signMessage`/`verifyMessages`),
capability labels + permission escalation (`escalatePermissionFromCapabilityLabels`),
secret masking applied before entries hit disk (`maskSecretsInString`), and
optional at-rest log encryption (`AGENTTRAIL_ENCRYPTION_KEY`).

State directory: `AGENTTRAIL_HOME` (default `~/.agenttrail`).

## How the chain works

```
hash_n = SHA-256( hash_{n-1} + JSON(entry_n) )
```

Each entry records tool, sanitized args, action (execute/deny/error/block),
timestamp, session, sequence, `prevHash`, and its own `hash`. Verification
re-walks the chain from genesis; the first modified, inserted, or deleted
entry breaks every hash after it.

## Roadmap

1. `agenttrail` CLI — `init`, `verify`, `export --sarif`
2. Claude Code hook adapter — PreToolUse/PostToolUse integration so any
   Claude Code session gets a flight recorder with one command
3. Log-format spec v0.1 — so independent implementations can verify each
   other's chains
