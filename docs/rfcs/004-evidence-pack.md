# RFC 004 — Compliance Evidence Pack

**Status**: design, not built. Phase 1 slice scoped; implementation deferred.
**Author**: Claude (scoping session 2026-05-04)
**Estimated effort**: Phase 1 = 3–5 days. Phase 2 + paid tier = follow-on.
**Audience**: security-conscious teams and regulated buyers (SOC 2 Type I/II,
ISO 27001 candidates) who already have CodeBot's hash-chained audit log and
need to hand something tangible to an auditor.

## Problem

`docs/SOC2_COMPLIANCE.md` ends with an "Evidence Artifacts for Auditors" table
that lists 13 different paths and commands. Today, "prepare for an audit"
means the operator runs `codebot --export-audit sarif` for _each session_,
runs `--verify-audit`, copies static docs, and assembles a folder by hand.
That works once. It does not scale to a quarterly Type II evidence period.

The asset that closes the gap is a **single command that produces one
auditor-ready bundle for a date range**, signed by the chain it came from.
Open-core: anyone can produce a bundle. Paid (later): auto-mapping of
artifacts to specific SOC 2 / ISO 27001 controls, auditor portal, signing
key infrastructure.

## What already exists (verified 2026-05-04)

- `src/audit.ts:130 log()` — append-only, SHA-256 hash-chained, encrypted
  per-line, secret-masked args. JSONL at `~/.codebot/audit/audit-YYYY-MM-DD.jsonl`.
- `src/audit.ts:165 query()` — filter by tool/action/since/sessionId.
- `src/audit.ts:196 verify()` — walks the chain, returns `VerifyResult` with
  legacy detection.
- `src/sarif.ts exportSarif()` + `src/cli.ts:358 --export-audit sarif` — converts
  audit entries to SARIF 2.1.0.
- 25+ audit action types covering tool execution, capability/policy/CORD
  blocks, model routing, budget thresholds, task lifecycle (PR 27 task\_\*).
- `docs/SOC2_COMPLIANCE.md` — 300-line CC1–CC9 mapping, evidence artifact
  table, sample policy, comparison vs. Copilot/Cursor/Auto-GPT.

## What does NOT exist

- A bundling command that combines audit + SARIF + cover letter + manifest
  for a date range into a single artifact.
- Period-level integrity (today the chain is verified per-session; for an
  evidence period an auditor wants one verification result for the whole
  period).
- A manifest mapping which file in the bundle answers which SOC 2 control.
- Anything resembling "here is the bundle, give it to your auditor."

## Phase 1 slice — minimum viable evidence pack

### Goal

One CLI command produces a directory bundle (zipped) containing the dynamic
audit evidence for an arbitrary date range, with a manifest mapping each
artifact to the SOC 2 controls it serves.

### CLI surface

```
codebot --evidence-pack \
  --since 2026-04-01 --until 2026-04-30 \
  --output ./evidence-2026-04
```

Optional flags:

- `--zip` (default true) — zip the directory at the end
- `--include-static-docs` — also bundle SECURITY.md, THREAT_MODEL.md, etc.
- `--session-id <id>` — restrict to a single session

### Bundle contents (Phase 1)

```
evidence-2026-04/
├── audit.jsonl              # all entries in range, decrypted
├── audit.sarif              # SARIF 2.1.0 export of denials/blocks
├── verification.json        # AuditLogger.verify() result for the period
├── summary.md               # human-readable cover letter
├── manifest.json            # artifact → SOC 2 control mapping
└── bundle-hash.txt          # SHA-256 of every file in the bundle
```

Concretely:

- **audit.jsonl** — all entries from `query({ since, until })`, written as
  decrypted JSONL (auditor needs to read it, not the encrypted-on-disk form).
  Hash chain preserved so the auditor can independently verify.
- **audit.sarif** — `exportSarif()` over the same entries.
- **verification.json** — `{ valid: bool, sessionsCovered: N, entriesChecked: M,
legacySessions: K, firstInvalidAt: null, periodStart, periodEnd }`. One
  number for the whole period instead of 30 per-session results.
- **summary.md** — generated cover letter:
  - Period start/end
  - Total sessions, total audit entries
  - Verification status (pass/fail with reason)
  - Action histogram (`execute` count, `deny` count, `policy_block` count, …)
  - Top 10 denied actions with counts
  - "What a reviewer should look at next" — a one-paragraph reading guide
- **manifest.json** — for each artifact in the bundle, list the SOC 2
  controls it provides evidence for. Hand-curated mapping, lifted from
  `docs/SOC2_COMPLIANCE.md` "Evidence Artifacts" table:
  ```json
  {
    "audit.jsonl": { "controls": ["CC4.1", "CC7.3"], "type": "logs" },
    "audit.sarif": { "controls": ["CC2.1", "CC7.2"], "type": "static_analysis" },
    "verification.json": { "controls": ["CC7.3"], "type": "integrity_check" }
  }
  ```
- **bundle-hash.txt** — SHA-256 of each file, plus a SHA-256-of-hashes for
  the bundle itself. Auditor can re-hash the bundle and prove nothing was
  tampered after generation.

### What's deliberately NOT in Phase 1

- **No PDF output** — markdown summary only. PDFs add a typesetting step
  for no real audit benefit; auditors read markdown fine.
- **No automated SOC 2 / ISO 27001 control assessment** — the manifest is a
  hand-curated mapping, not "we evaluated CC7.3 and conclude PASS." That's
  the paid tier's job.
- **No static-doc auto-bundling by default** — opt-in via flag. Static docs
  are stable and don't belong in every period bundle.
- **No signing with org-controlled key** — bundle hash gives integrity for
  Phase 1; org-key signing is paid-tier.
- **No web UI / dashboard surface** — CLI command, file output. The
  dashboard team can come later if there's demand.

### Anti-theater measurement for Phase 1

| Step          | What's measured                                                                                                                                                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline      | `docs/SOC2_COMPLIANCE.md` lists 13 evidence paths/commands; today the operator assembles them by hand.                                                                                                                                                    |
| After Phase 1 | One command produces a bundle that covers 4 of those 13 (audit logs, SARIF reports, integrity verification, action summary).                                                                                                                              |
| Validation    | Run the command against a real audit period, hand the bundle to ≥3 people who have done a SOC 2 audit, ask: _"Would you accept this as evidence for CC4.1, CC4.2, CC7.2, CC7.3?"_ If 0/3 say yes, the bundle is wrong; iterate before claiming the slice. |

The validation step is the real anti-theater check. Producing a bundle that
_looks_ official but doesn't satisfy a real auditor would be worse than not
shipping it.

### File-level scope

- New: `src/evidence-pack.ts` — bundle generation logic (~200 lines).
- New: `src/cli/evidence-pack.ts` — CLI flag handler (~80 lines).
- New: `src/evidence-pack.test.ts` — unit tests + golden-file integration test
  on a fixture audit log.
- New: `bench/fixtures/audit-fixture-period.jsonl` — synthetic audit period
  for golden-file testing.
- Modify: `src/cli.ts` — register `--evidence-pack` flag in the argparser.
- Modify: `docs/SOC2_COMPLIANCE.md` — add a one-paragraph pointer to the
  command in the "Evidence Artifacts" section.
- Modify: `README.md` — one-line mention in features list.

No changes to `audit.ts`, `sarif.ts`, or any existing code path. Phase 1 is
purely additive.

## Phase 2 — bundling polish (deferred, ~1 week after Phase 1 ships)

- Include static docs (`SECURITY.md`, `THREAT_MODEL.md`, `HARDENING.md`,
  `POLICY_GUIDE.md`, `COMPLIANCE.md`, `PRIVACY.md`, `ARCHITECTURE.md`)
  in the bundle by default.
- Per-control summary in `summary.md`: for each CC1–CC9 control, list which
  bundle artifacts apply and a one-line "in the period covered, X happened."
- Risk score distribution, denial-pattern analysis.
- Optional PDF render of `summary.md` via pandoc (only if buyers ask).

## Phase 3 — paid tier (deferred, scope decision needed)

The paid-tier hooks the open-core bundle leaves room for:

- **Auto-mapping** — for each artifact in the bundle, evaluate against a
  named SOC 2 control / ISO 27001 clause and produce a confidence score
  ("CC7.3: PASS — 47 verify-audit runs, 0 failures, 100% chain continuity").
  This is the work an auditor charges $30K+ for. We do not match a human
  auditor's judgment, but we produce the inputs an auditor would charge for
  preparing.
- **Org-key signing** — sign the bundle with a key the org controls; auditor
  verifies signature against a public key the org publishes.
- **Auditor portal** — web UI to browse bundles, click into specific control
  evidence, leave notes. Replaces the "send a zip and pray they read it"
  workflow.
- **Multi-tenant evidence vault** — for orgs with multiple CodeBot deployments,
  centralized evidence aggregation with per-team scoping.

**Positioning question for Phase 3**: open the auto-mapper, charge for the
auditor portal? Or charge for the auto-mapper, open the portal? I lean
toward "open auto-mapper (so anyone can self-assess), paid portal (because
the portal is the recurring value during an audit period)." But this is a
GTM decision, not a code decision. Defer until ≥3 buyer conversations.

## Decision gate before any code is written

Per the GTM plan's anti-theater discipline (`docs/gtm/README.md`), Phase 1
should not be built unless one of these is true:

- ≥1 inbound asking _"how do I prepare a SOC 2 evidence period from
  CodeBot?"_
- ≥1 paying-customer prospect would not buy without it
- It costs less than 5 days and lifts the GTM hypothesis test materially
  (the third pillar — _"runs where your code can't leave"_ — is also the
  audit-evidence pillar)

The third condition is the one that already holds. Phase 1 is 3–5 days,
purely additive, and shores up the positioning even before a buyer asks.

But Phase 2 and the paid tier should NOT be built without a real buyer
conversation. Phase 1 buys you the right to have that conversation.

## Open questions

1. **Date range semantics** — `--since` is timestamp-prefix matched against
   `entry.timestamp` (ISO 8601 UTC). Inclusive on both ends? Honest answer:
   inclusive `since`, exclusive `until` (the "[start, end)" convention).
2. **Decryption for the bundle** — the on-disk audit log is encrypted line-by-line
   via `encryption.ts`. The bundle contains _decrypted_ JSONL so an auditor
   can read it. Trade-off: decrypted contents leave the encryption boundary.
   Mitigation: auditor receives the bundle via the org's existing secure
   channel (SFTP, encrypted email, evidence portal). Document this in
   `summary.md`.
3. **What about secrets in the audit log?** — `audit.ts:310 sanitizeArgs()`
   already masks via `maskSecretsInString` and truncates at 500 chars before
   logging. If something slipped past, it's already in the audit log. Phase
   1 does not re-scan; secret hygiene is upstream of evidence packaging.
4. **Bundle size** — a busy month is millions of audit entries. Bundle size
   could exceed 1GB. Phase 1: stream-write JSONL, compress. Phase 2: optional
   "summary-only" mode that omits per-entry detail, keeps action histograms.

## Why this slice and not something bigger

Tempting alternatives, all rejected for Phase 1:

- _"Build a real-time compliance dashboard"_ — months of work, no buyer yet.
- _"Auto-generate the SOC 2 narrative report"_ — requires an LLM judgment
  call per control; unreviewable; auditors will reject it.
- _"Integrate with Drata/Vanta/Tugboat"_ — vendor-specific work; one inbound
  hasn't materialized yet.

Phase 1 is the smallest thing that would (a) take 3–5 days, (b) be useful
the moment it ships, (c) survive the anti-theater test, and (d) leave room
for everything else above. If no buyer ever materializes, the work is still
defensible: it makes the open-core product more credible to the
security-conscious teams the GTM hypothesis targets.
