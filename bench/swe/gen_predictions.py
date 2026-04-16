#!/usr/bin/env python3
"""
SWE-bench prediction generator for CodeBot AI.

Loads a SWE-bench dataset (Verified / Lite / Full), and for each task:
  1. Clones the repo into a tempdir at the base_commit
  2. Invokes `codebot` CLI with the problem_statement
  3. Captures the resulting `git diff` as the model_patch
  4. Appends one row to the predictions JSON file

Output schema matches the official SWE-bench harness:
  [
    {
      "instance_id": "<repo>__<issue#>",
      "model_name_or_path": "codebot-ai-2.10.0-<provider-model>",
      "model_patch": "diff --git a/...\n..."
    },
    ...
  ]

Run:
  python gen_predictions.py --dataset princeton-nlp/SWE-bench_Verified \
                            --max-instances 5 \
                            --output predictions.json

This script is INTENTIONALLY simple and verbose. SWE-bench is the kind
of thing that's easy to fake (you can produce a "predictions.json" of
all-empty patches and the harness will report 0% with no error). We
log every step so you can see the run actually happened.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

try:
    from datasets import load_dataset  # type: ignore
except ImportError:
    sys.stderr.write(
        "ERROR: datasets package not installed. Run:\n"
        "  pip install -r requirements.txt\n"
    )
    sys.exit(2)


@dataclass
class TaskResult:
    instance_id: str
    success: bool
    elapsed_sec: float
    diff_size_bytes: int
    error: Optional[str] = None
    log_excerpt: str = ""


@dataclass
class RunStats:
    total: int = 0
    succeeded: int = 0  # produced a non-empty diff
    failed: int = 0
    elapsed_total_sec: float = 0.0
    results: list[TaskResult] = field(default_factory=list)


def find_codebot_binary() -> str:
    """Locate the codebot CLI. Prefer the local repo's bin over PATH."""
    here = Path(__file__).resolve().parent
    repo_root = here.parent.parent
    local = repo_root / "bin" / "codebot"
    if local.is_file() and os.access(local, os.X_OK):
        return str(local)
    # Fall back to PATH.
    found = subprocess.run(["which", "codebot"], capture_output=True, text=True)
    if found.returncode == 0 and found.stdout.strip():
        return found.stdout.strip()
    raise RuntimeError(
        "Could not find `codebot` binary. Tried local bin/ and PATH. "
        "Run `npm run build && npm link` from the repo root, or pass --codebot-path."
    )


def run_one_task(
    instance: dict,
    codebot_bin: str,
    timeout_sec: int,
    workspace_root: Path,
) -> tuple[Optional[str], TaskResult]:
    """Run CodeBot on a single SWE-bench instance, return (model_patch, TaskResult)."""
    instance_id = instance["instance_id"]
    repo = instance["repo"]
    base_commit = instance["base_commit"]
    problem_statement = instance.get("problem_statement", "")
    started = time.monotonic()

    workdir = workspace_root / instance_id
    workdir.mkdir(parents=True, exist_ok=True)

    log_lines: list[str] = []

    def log(msg: str) -> None:
        line = f"[{instance_id}] {msg}"
        print(line, flush=True)
        log_lines.append(line)

    try:
        log(f"clone {repo} @ {base_commit[:8]}")
        clone_url = f"https://github.com/{repo}.git"
        clone = subprocess.run(
            ["git", "clone", "--quiet", clone_url, str(workdir)],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if clone.returncode != 0:
            err = f"git clone failed: {clone.stderr.strip()[:200]}"
            log(err)
            return None, TaskResult(
                instance_id=instance_id,
                success=False,
                elapsed_sec=time.monotonic() - started,
                diff_size_bytes=0,
                error=err,
                log_excerpt="\n".join(log_lines[-20:]),
            )

        checkout = subprocess.run(
            ["git", "-C", str(workdir), "checkout", "--quiet", base_commit],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if checkout.returncode != 0:
            err = f"checkout failed: {checkout.stderr.strip()[:200]}"
            log(err)
            return None, TaskResult(
                instance_id=instance_id,
                success=False,
                elapsed_sec=time.monotonic() - started,
                diff_size_bytes=0,
                error=err,
                log_excerpt="\n".join(log_lines[-20:]),
            )

        log("invoking codebot --auto")
        # We pipe the problem_statement as the task. --auto skips approvals.
        # CWD is the cloned repo so all of CodeBot's tools operate inside it.
        codebot_proc = subprocess.run(
            [codebot_bin, "--auto", "--no-banner", problem_statement],
            cwd=str(workdir),
            capture_output=True,
            text=True,
            timeout=timeout_sec,
        )
        if codebot_proc.returncode != 0:
            log(f"codebot exited with code {codebot_proc.returncode}")
            log(f"stderr tail: {codebot_proc.stderr[-500:]}")

        log("capturing git diff")
        diff = subprocess.run(
            ["git", "-C", str(workdir), "diff", base_commit],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if diff.returncode != 0:
            err = f"git diff failed: {diff.stderr.strip()[:200]}"
            log(err)
            return None, TaskResult(
                instance_id=instance_id,
                success=False,
                elapsed_sec=time.monotonic() - started,
                diff_size_bytes=0,
                error=err,
                log_excerpt="\n".join(log_lines[-20:]),
            )

        patch = diff.stdout
        elapsed = time.monotonic() - started
        if not patch.strip():
            log(f"WARN: empty diff after {elapsed:.1f}s — codebot did not modify anything")
            return None, TaskResult(
                instance_id=instance_id,
                success=False,
                elapsed_sec=elapsed,
                diff_size_bytes=0,
                error="empty_diff",
                log_excerpt="\n".join(log_lines[-20:]),
            )

        log(f"OK — diff size {len(patch)} bytes, elapsed {elapsed:.1f}s")
        return patch, TaskResult(
            instance_id=instance_id,
            success=True,
            elapsed_sec=elapsed,
            diff_size_bytes=len(patch),
            log_excerpt="\n".join(log_lines[-20:]),
        )

    except subprocess.TimeoutExpired:
        elapsed = time.monotonic() - started
        log(f"TIMEOUT after {elapsed:.1f}s")
        return None, TaskResult(
            instance_id=instance_id,
            success=False,
            elapsed_sec=elapsed,
            diff_size_bytes=0,
            error="timeout",
            log_excerpt="\n".join(log_lines[-20:]),
        )
    except Exception as e:  # noqa: BLE001
        elapsed = time.monotonic() - started
        log(f"EXCEPTION: {e}")
        return None, TaskResult(
            instance_id=instance_id,
            success=False,
            elapsed_sec=elapsed,
            diff_size_bytes=0,
            error=str(e),
            log_excerpt="\n".join(log_lines[-20:]),
        )


def main() -> int:
    p = argparse.ArgumentParser(description="Generate SWE-bench predictions with CodeBot AI")
    p.add_argument("--dataset", default="princeton-nlp/SWE-bench_Verified",
                   help="HuggingFace dataset id (default: SWE-bench_Verified)")
    p.add_argument("--split", default="test", help="Dataset split (default: test)")
    p.add_argument("--instance-ids", default="",
                   help="Comma-separated list of specific instance_ids to run (overrides --max-instances)")
    p.add_argument("--max-instances", type=int, default=1,
                   help="How many instances to run (default: 1 — change before a real run)")
    p.add_argument("--output", default="predictions.json", help="Output JSON file")
    p.add_argument("--codebot-path", default="", help="Override path to codebot binary")
    p.add_argument("--timeout-sec", type=int, default=900,
                   help="Per-task wall-clock budget for codebot (default 15 min)")
    p.add_argument("--workspace", default="",
                   help="Workspace dir for cloned repos (default: tempdir; preserved on success for inspection)")
    args = p.parse_args()

    codebot_bin = args.codebot_path or find_codebot_binary()
    print(f"# codebot binary: {codebot_bin}")

    print(f"# loading dataset {args.dataset!r} split={args.split!r}")
    ds = load_dataset(args.dataset, split=args.split)
    print(f"# dataset loaded: {len(ds)} instances")

    if args.instance_ids:
        wanted = {x.strip() for x in args.instance_ids.split(",") if x.strip()}
        instances = [r for r in ds if r["instance_id"] in wanted]
        print(f"# filtering to {len(instances)} requested instance(s)")
    else:
        instances = list(ds)[: args.max_instances]
        print(f"# taking first {len(instances)} instance(s) (use --max-instances to change)")

    if not instances:
        print("ERROR: no instances selected")
        return 2

    workspace_root = Path(args.workspace) if args.workspace else Path(tempfile.mkdtemp(prefix="swebench-"))
    workspace_root.mkdir(parents=True, exist_ok=True)
    print(f"# workspace: {workspace_root}")

    predictions: list[dict] = []
    stats = RunStats(total=len(instances))

    for i, instance in enumerate(instances, 1):
        print(f"\n=== {i}/{len(instances)}: {instance['instance_id']} ===")
        patch, result = run_one_task(instance, codebot_bin, args.timeout_sec, workspace_root)
        stats.results.append(result)
        stats.elapsed_total_sec += result.elapsed_sec
        if patch is not None:
            stats.succeeded += 1
            predictions.append({
                "instance_id": instance["instance_id"],
                "model_name_or_path": "codebot-ai-2.10.0",  # TODO: detect actual provider/model
                "model_patch": patch,
            })
        else:
            stats.failed += 1

    out_path = Path(args.output).resolve()
    out_path.write_text(json.dumps(predictions, indent=2))
    print(f"\n# wrote {len(predictions)} predictions to {out_path}")

    # Sidecar run log so we can audit later.
    log_path = out_path.with_suffix(".run.json")
    log_path.write_text(json.dumps({
        "dataset": args.dataset,
        "split": args.split,
        "total": stats.total,
        "succeeded_diff_produced": stats.succeeded,
        "failed": stats.failed,
        "elapsed_total_sec": round(stats.elapsed_total_sec, 1),
        "per_task": [r.__dict__ for r in stats.results],
    }, indent=2))
    print(f"# wrote run log to {log_path}")

    print("\n# === SUMMARY ===")
    print(f"# instances attempted:     {stats.total}")
    print(f"# produced non-empty diff: {stats.succeeded}")
    print(f"# failed / empty:          {stats.failed}")
    print(f"# total wall time:         {stats.elapsed_total_sec:.1f}s")
    print()
    print("# Diff produced != test passing. Run eval.sh next to score:")
    print(f"#   bash eval.sh {out_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
