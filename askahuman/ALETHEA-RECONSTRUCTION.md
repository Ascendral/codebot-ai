# Alethea — reconstruction notes

**Status:** The original Alethea session lived only on Alex's MacBook Air,
which took severe impact damage on 2026-07-12. Physical recovery pending
(power test, Apple diagnosis). This file rebuilds the substance from
Alex's memory so the idea survives regardless of the hardware.

## What Alex remembers (verbatim, 2026-07-12)

> "It was an accountability layer implementation to any major LLM."

## Why this matters — the convergence

While the Alethea session existed on the Mac, a parallel session (this
repo's) independently built **agenttrail**: a tamper-evident accountability
layer for AI agents (hash-chained action log, policy gate, risk scoring,
Claude Code hook adapter — 254 tests, validated live). Same thesis, two
sessions, one brain. Alethea and agenttrail are siblings:

- **agenttrail** inserts at the AGENT TOOL layer (hooks around what an
  agent *does* — files, commands, network)
- **Alethea** (apparent design) inserts at the LLM API layer — a layer
  around any major LLM provider, accountability for what models *say/claim*
  regardless of which vendor serves them

Together they'd cover both halves: what the model claims, and what the
agent does about it. Note this repo already contains a Cloudflare Worker
LLM proxy (`proxy/`) — prior art for the provider-layer insertion point.

## Reconstruction questions for Alex (answer in any order, voice-note ok)

1. Insertion point: was Alethea a proxy/middleware you'd point your app's
   LLM calls through? A library? Something else?
2. What did it record or enforce per call? (claims vs evidence? token
   costs? refusals? hallucination flags?)
3. How far did the session get — idea, design doc, working code, tests?
4. Was anything pushed anywhere (a repo, a gist, a note app)?
5. What was the one feature you were most excited about?

## Standing rule (paid for twice now)

Anything that matters gets committed and pushed the day it exists.
Alethea lived on one disk and is now hostage to hardware. agenttrail
lived in git and survived. Same week, same idea, opposite outcomes.
