# CodeBot AI on SWE-bench Verified — 50-task slice, Docker-scored

**Run date**: 2026-04-16, finished 21:55 PDT
**Run ID**: `verified-50-20260416-202834`
**Status**: ✅ complete, official harness, 0 errors

## Headline numbers

| Metric | Value |
|---|---|
| Tasks attempted | **50** (first 50 of 500-task SWE-bench Verified by ID) |
| Patches produced | **33** (CodeBot gave up with empty diff on 17) |
| Patches submitted to harness | 33 |
| **Resolved (test suite passes)** | **17** |
| Unresolved (test suite fails) | 16 |
| Errors / crashes | 0 |
| **Pass rate over attempted (17/50)** | **34.0 %** |
| Pass rate over submitted (17/33) | 51.5 % |

The **34.0 %** number is the leaderboard-comparable framing; the 51.5 % is what the harness's `report.json` reports natively (it normalizes by submitted patches, ignoring give-ups).

## Resources used

| | Value |
|---|---|
| Model | `gpt-5.4` (resolved to `gpt-5.4-2026-03-05`) |
| Provider path | `OpenAIResponsesProvider` → `/v1/responses` |
| Phase 1 wall (gen, sequential) | 64.2 min |
| Phase 2 wall (Docker eval, max_workers=2) | 22.4 min |
| **Total wall** | **86.6 min** |
| Per-task gen time | min 29.9 s, max 144.4 s, avg 77.0 s |
| Per-task patch size | min 614 B, max 5,388 B, avg 2,172 B |
| Docker runtime | Colima 0.10.1 / Docker 29.4.0 / vz + Rosetta 2 |
| CodeBot version | 2.10.0 |

API cost estimate: smoke task used ~130 K tokens / $0.27. Average gen task here was 77 s (vs 44 s smoke), consistent with similar token counts. Rough total **≈ $10–15**.

## Resolved tasks (17)

```
astropy__astropy-12907  ✓
astropy__astropy-13453  ✓
astropy__astropy-13579  ✓
astropy__astropy-14309  ✓
astropy__astropy-14508  ✓
astropy__astropy-14995  ✓
astropy__astropy-7336   ✓
django__django-10880    ✓
django__django-11066    ✓
django__django-11099    ✓
django__django-11119    ✓
django__django-11133    ✓
django__django-11179    ✓
django__django-11239    ✓
django__django-11276    ✓
django__django-11292    ✓
django__django-11451    ✓
```

Repo split: **Astropy 7/14 attempted-with-patch (50 %), Django 10/19 (53 %)**.

## Failure breakdown

- **17 empty diffs** — CodeBot's agent loop terminated without modifying any files. This is the dominant failure mode (34 % of attempted). Likely causes: hard problem, model couldn't form a plan, or hit max iterations. Worth investigating per-task to see if a longer iteration budget or better problem-statement priming would help.
- **16 unresolved** — patch was produced but didn't fix the bug or broke other tests. This is the harder failure mode and reflects genuine reasoning limits.
- **0 errors** — no crashes, harness or CodeBot. Pipeline is solid.

## Caveats

- **Slice is alphabetical**, not random. First 50 instances of SWE-bench Verified ordered by ID — mostly Astropy + early Django. Top-leaderboard systems publish on the full 500. Our 34 % may shift on the rest.
- **`max_workers=2`** in eval to avoid Docker pressure on a 32 GB machine. Higher parallelism would reduce wall time but doesn't change scores.
- **No iteration retries**, **no patch sampling**, **no test-driven loop**. CodeBot ran each task once, took whatever diff `git diff` showed at the end.

## Comparison

SWE-bench Verified leaderboard (full 500, as of run date — verify against [official site](https://swebench.com)):
- Top closed-source systems: ~60–65 %
- Top open-source: ~50–55 %
- Mid-tier open-source: ~30–45 %

**CodeBot's 34 % on a 50-task slice puts it in the mid-tier open-source range.** Result on the full 500 would be needed to claim a leaderboard spot.

## Reproducing

```bash
cd bench/swe
source .venv/bin/activate
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"

# 50 tasks, sequential gen + 2-parallel Docker eval, ~90 min total
bash run-50.sh

# Status:
tail -f /tmp/swe50-eval.log
ls /tmp/swe50-DONE         # success sentinel
cat /tmp/swe50-final.log   # summary
```

Report JSON: `bench/swe/codebot-ai-2.10.0.verified-50-20260416-202834.json`.

## What this supersedes

- `swe-bench-verified-2026-04-15-smoke.md` (N=1, no Docker eval)
- `swe-bench-verified-2026-04-16-smoke-resolved.md` (N=1 with Docker, kept as the known-good single-task evidence)
