#!/usr/bin/env python3
"""
Turn a SWE-bench harness `report.json` + our `predictions.run.json` into
a publishable markdown summary. This is the artifact that goes into
docs/benchmarks/ and gets cited in the README + content posts.

Output schema (mandatory — no fudging):
  - Dataset name and split
  - Date and run_id
  - Model used (provider + model name)
  - Total instances attempted
  - Resolved (test passes after applying our patch)
  - Empty-diff rate (we couldn't even produce a change)
  - Timeout rate
  - Wall-clock total
  - Per-instance table

Run:
  python summarize.py predictions.json results.json > out.md

If you don't have results.json yet (eval.sh failed or hasn't run),
pass --predictions-only to summarize what we generated without scoring.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path


def load_json(path: str) -> dict | list:
    with open(path) as f:
        return json.load(f)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("predictions_json", help="predictions.json from gen_predictions.py")
    ap.add_argument("results_json", nargs="?", help="report.json from eval.sh (omit if not yet scored)")
    ap.add_argument("--predictions-only", action="store_true",
                    help="Skip scoring section; only summarize generation phase")
    ap.add_argument("--dataset", default="SWE-bench Verified",
                    help="Human-readable dataset name for the title")
    args = ap.parse_args()

    predictions = load_json(args.predictions_json)
    if not isinstance(predictions, list):
        sys.stderr.write("ERROR: predictions file is not a JSON list\n")
        return 2

    run_log_path = Path(args.predictions_json).with_suffix(".run.json")
    run_log: dict = {}
    if run_log_path.is_file():
        run_log = load_json(str(run_log_path))

    today = datetime.utcnow().strftime("%Y-%m-%d")
    out: list[str] = []
    out.append(f"# CodeBot AI on {args.dataset} — {today}")
    out.append("")
    out.append("> Reproducible benchmark run. Methodology and raw data linked at the bottom.")
    out.append("")

    total = run_log.get("total", len(predictions))
    diff_produced = run_log.get("succeeded_diff_produced", len(predictions))
    failed = run_log.get("failed", 0)
    elapsed = run_log.get("elapsed_total_sec", 0)

    out.append("## Generation phase")
    out.append("")
    out.append("| Metric | Value |")
    out.append("|---|---|")
    out.append(f"| Dataset | `{run_log.get('dataset', args.dataset)}` |")
    out.append(f"| Instances attempted | {total} |")
    out.append(f"| Produced non-empty diff | {diff_produced} |")
    out.append(f"| Failed / timeout / empty diff | {failed} |")
    out.append(f"| Total wall time | {elapsed/60:.1f} min |")
    if total > 0:
        out.append(f"| Diff-produced rate | {100.0 * diff_produced / total:.1f}% |")
    out.append("")

    if args.predictions_only or not args.results_json:
        out.append("> **Scoring not yet run.** Run `bash eval.sh predictions.json` and re-run this script with the resulting report.json to add the scoring section.")
        out.append("")
    else:
        results = load_json(args.results_json)
        if not isinstance(results, dict):
            sys.stderr.write("ERROR: results file is not a JSON object\n")
            return 2

        # The official report.json has aggregate counts at the top level.
        # Field names: completed_instances, resolved_instances, etc.
        completed = results.get("completed_instances", 0)
        resolved = results.get("resolved_instances", 0)
        empty_patch = results.get("empty_patch_instances", 0)
        unresolved = results.get("unresolved_instances", 0)
        error = results.get("error_instances", 0)

        out.append("## Scoring phase")
        out.append("")
        out.append("| Metric | Value |")
        out.append("|---|---|")
        out.append(f"| Completed (harness ran) | {completed} |")
        out.append(f"| **Resolved (test passes)** | **{resolved}** |")
        out.append(f"| Unresolved (patch applied but test still fails) | {unresolved} |")
        out.append(f"| Empty patch | {empty_patch} |")
        out.append(f"| Error during eval | {error} |")
        if completed > 0:
            pct = 100.0 * resolved / completed
            out.append(f"| **Pass rate** | **{pct:.1f}%** ({resolved}/{completed}) |")
        out.append("")

    out.append("## Per-task results")
    out.append("")
    if run_log.get("per_task"):
        out.append("| Instance | Status | Wall (s) | Diff (B) | Notes |")
        out.append("|---|---|---|---|---|")
        for r in run_log["per_task"]:
            status = "OK" if r["success"] else (r.get("error") or "fail")
            out.append(f"| `{r['instance_id']}` | {status} | {r['elapsed_sec']:.1f} | {r['diff_size_bytes']} | |")
        out.append("")

    out.append("## Reproduction")
    out.append("")
    out.append("```bash")
    out.append("cd bench/swe")
    out.append("python -m venv .venv && source .venv/bin/activate")
    out.append("pip install -r requirements.txt")
    out.append("python gen_predictions.py \\")
    out.append(f"  --dataset '{run_log.get('dataset', args.dataset)}' \\")
    out.append(f"  --max-instances {total} \\")
    out.append("  --output predictions.json")
    out.append("bash eval.sh predictions.json")
    out.append("python summarize.py predictions.json logs/.../report.json")
    out.append("```")
    out.append("")

    out.append("## Honest disclaimers")
    out.append("")
    out.append("- These numbers are the result of one run. Re-running with the same inputs may produce different scores due to LLM nondeterminism.")
    out.append("- The model used was whichever provider/model was active in `~/.codebot/config.json` at run time.")
    out.append("- Test pass != production-quality fix. SWE-bench validates that the failing test now passes; it does not guarantee no regressions in tests that were already passing (the harness checks `PASS_TO_PASS` for that, but the binary metric here is `resolved`).")
    out.append("- Failed runs are counted as failures in the rate. Timeouts, empty diffs, and harness errors all count against the score. This matches the leaderboard methodology.")
    out.append("")

    print("\n".join(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
