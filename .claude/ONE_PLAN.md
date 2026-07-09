# THE ONE PLAN — 8 weeks, one wedge, one number

Written 2026-07-09. Supersedes GAME_PLAN.md (stale) as the active plan.
Companion docs: ASSESSMENT-2026-04-28.md (what's real), EXTRACTION_SCOPE.md
(the build spec for Phase 1).

## The diagnosis, stated once

The portfolio is seven surfaces deep and zero users wide: CodeBot CLI,
Electron app, VS Code extension, GitHub Action, dashboard, CORD, SPARK,
proxy, deck, landing, videos. Every one of them is *input*. None of them
has produced the only output that buyers, acquirers, or investors price:
**evidence that a stranger wants this.**

The failure mode is not laziness — the test count proves the opposite.
The failure mode is breadth: each new surface restarts the clock instead
of compounding. The fix is one wedge, sequenced, with a number that
decides continue-or-kill BEFORE launch so the result can't be spun.

## The wedge (decided, not revisited until the gate)

**The flight recorder + policy gate for Claude Code** (per EXTRACTION_SCOPE.md).

Why this asset and not the others:
1. **Differentiated** — nobody ships tamper-evident audit for agent actions
2. **Rides existing distribution** — installs into Claude Code's install
   base via hooks; does not require anyone to switch agents
3. **80% built and tested** — ~2,700 lines extract cleanly, zero deps
4. **Active buyers exist** — security/compliance platforms are shopping
   this exact category; EU AI Act logging obligations are the tailwind

Everything else is FROZEN for 8 weeks: no CodeBot features, no Electron
work, no memory vault, no v3.0 roadmap, no new repos, no new videos.
Frozen ≠ dead — the memory vault is explicitly module two IF the gate
passes.

## Phase 1 — Build the minimum sellable thing (weeks 1–3)

Per EXTRACTION_SCOPE.md. Definition of done (all three, verified):
- [ ] `npm i -g <name> && <name> init` works in any Claude Code repo
- [ ] `<name> verify` proves/breaks the chain; `export --sarif` validates
- [ ] 60-second demo recorded: rogue action blocked → chain verified →
      SARIF in CI

Anti-theater rule: no "done" without the terminal output in the README.

## Phase 2 — Demand test (weeks 3–6)

Launch surfaces, in order:
1. Show HN ("I built a tamper-evident flight recorder for Claude Code")
2. Claude Code / AI-engineering communities (Reddit, Discord, X)
3. 20 direct messages to security engineers / platform leads at companies
   known to run agent tooling — the ask is 15 minutes, not money

**The number, fixed now:** by end of week 6 —
- 25+ installs (npm downloads don't count; `init` runs do, if measurable,
  else GitHub clones + issues as proxy)
- 5 real conversations with a security/compliance owner
- 1 team that says "we would pilot this" in writing

## The gate (week 7–8) — decided by the number, not by mood

- **HIT** → double down: spec v0.2 with design-partner feedback, then take
  the evidence to (a) corp-dev at the 4 named buyer types in
  EXTRACTION_SCOPE.md and (b) 10 pre-seed investors with an AI-governance
  thesis. Team question answers itself: hire against demand or sell into
  a team.
- **MISS** → the wedge dies, cheaply, in 8 weeks. Next wedge from the
  stack (user-owned memory vault — same trust-layer story, second module)
  runs the SAME process. The process is the asset; each cycle costs 8
  weeks, not 2 years.
- **No spinning a miss as a partial hit.** 4 conversations is a miss.
  "People seemed interested" is a miss. The number is the number.

## What this plan refuses to do

- Build features while waiting for feedback ("productive procrastination")
- Add a second wedge before the gate ("portfolio insurance")
- Count likes, stars-from-friends, or lurker traffic as signal
- Treat the pitch deck as progress — decks describe evidence, they aren't it

## Weekly checkpoint ritual (15 min, Fridays)

1. What shipped this week (verification output or it didn't happen)
2. Installs / conversations count vs. the week-6 target line
3. One sentence: is the plan still the plan? (Changing it costs a written
   paragraph in this file explaining why — friction is the point)

## Why Alex can run this plan when most solo builders can't

Not flattery — inventory: shipped 20 versions with a disciplined tagged
commit history, built a 3-OS CI matrix, ran a real Docker-scored benchmark
and published the failure modes honestly, and already produced landing
pages, decks, and video pipelines (the distribution *skills* exist — they
were just aimed at a crowded category). The missing muscle is only the
ask: putting the thing in front of strangers and counting what happens.
That muscle is built by reps, and Phase 2 is 20 reps.
