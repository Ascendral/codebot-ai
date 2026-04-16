# CodeBot AI on SWE-bench Verified — 1-task smoke run, 2026-04-15

> **This is a smoke test, not a benchmark.** N=1. Published as proof that the harness works end-to-end after the Responses API provider landed (commit `0a041be`). A full 50-task or 500-task run is the next step and will replace this document.

## Result

| Metric | Value |
|---|---|
| Dataset | `princeton-nlp/SWE-bench_Verified`, split `test` |
| Instances attempted | **1** |
| Produced non-empty diff | 1 |
| Resolved (test passes) | **Not yet evaluated** — Docker harness not run |
| Wall time | 1m 12s |
| Token usage | 178,581 |
| Estimated cost | ~$0.08 (gpt-5.4 Responses API) |
| Model | `gpt-5.4-2026-03-05` (latest gpt-5.4 snapshot at run time) |
| CodeBot version | 2.10.0 |
| Run ID | smoke-2026-04-15 |

## What CodeBot did

Task: `astropy__astropy-12907` — "`separability_matrix` does not compute separability correctly for nested CompoundModels."

CodeBot's autonomous loop ran 10 iterations and made 16 tool calls before producing a 2 KB patch. The patch:

```diff
--- a/astropy/modeling/separable.py
+++ b/astropy/modeling/separable.py
@@ -242,7 +242,7 @@ def _cstack(left, right):
         cright = _coord_matrix(right, 'right', noutp)
     else:
         cright = np.zeros((noutp, right.shape[1]))
-        cright[-right.shape[0]:, -right.shape[1]:] = 1
+        cright[-right.shape[0]:, -right.shape[1]:] = right

     return np.hstack([cleft, cright])
```

Plus two new tests covering the nested-compound case.

## Why this matters

Earlier the same task with `gpt-4o-mini` produced an empty diff (1 tool call, agent gave up). With `gpt-5.4` via the new Responses API provider, the agent engaged end-to-end and produced a plausible fix.

| Model | API | Iterations | Tool calls | Diff |
|---|---|---|---|---|
| gpt-4o-mini | chat-completions | 2 | 1 | empty |
| gpt-5-mini | chat-completions | 1 | 0 | empty |
| gpt-5.1 | chat-completions | 1 | 0 | empty |
| **gpt-5.4** | **Responses API** | **10** | **16** | **2 KB patch** ✓ |

## What's still missing for a real benchmark number

This is N=1 and we have NOT run the official scoring harness yet. To turn this into a publishable number:

1. Run on 50 instances (SWE-bench Verified subset) — estimated cost: **~$4** at $0.08/task
2. Run the official `swebench.harness.run_evaluation` Docker harness against the predictions to compute pass rate
3. Re-render `docs/benchmarks/swe-bench-verified-2026-04.md` with real pass/fail counts

Estimated wall time for 50 instances: **3-8 hours** (Docker pulls + per-task LLM + Docker test runs).

## Reproduction

```bash
cd bench/swe
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python gen_predictions.py --max-instances 1 --model gpt-5.4 --output predictions.json
# To score (requires Docker):
bash eval.sh predictions.json
python summarize.py predictions.json logs/.../report.json
```

## Honest disclaimers

- **N=1.** Statistically meaningless. Don't cite this as "CodeBot's SWE-bench score."
- **Patch correctness not yet verified.** "Produced a diff" is necessary but not sufficient for "passes the test."
- **Cost estimate is the prediction-generation cost only.** Eval harness adds Docker pulls + test wall time.
- **Same task at different temperatures will produce different patches.** A real number requires multiple seeds.

## Bugs found while running this

The smoke test exposed 5 real bugs in CodeBot, filed as GitHub issues today. Two were fixed in commits `0a041be` and `967c0de`; three remain open (#5, #6, #7, #8).
