# agenttrail

**Tamper-evident flight recorder + policy gate for AI agents.**

Every action an agent takes — logged in a SHA-256 hash-chained, append-only
audit trail. Tamper with the log, the chain breaks, you know. Policy
enforcement and 7-factor risk scoring gate actions *before* they run.
SARIF 2.1.0 export feeds CI and SIEM.

Zero runtime dependencies. MIT.

## Status — pre-release (v0.1.0)

Extracted from [codebot-ai](https://github.com/Ascendral/codebot-ai)'s
production audit/policy layer (shipped across 20 versions, exercised by its
1,979-test suite). This package's own suite: **237 tests / 46 suites,
passing**.

What works today (verified, not asserted):

```
$ node --test dist/*.test.js
# tests 237
# pass 237
# fail 0

$ node smoke: log 3 entries → verify → tamper 1 byte → verify
verify clean log:    {"valid":true,"entriesChecked":3}
verify tampered log: {"valid":false,"firstInvalidAt":1,
                      "reason":"Hash mismatch at sequence 1: ..."}
```

Not built yet (see roadmap): the `agenttrail` CLI, the Claude Code hook
adapter (`agenttrail init`), and the log-format spec document.

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
