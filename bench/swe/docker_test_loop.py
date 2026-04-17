"""
Tier 2.1 v2 — Docker-based test-driven inner loop.

Uses the official SWE-bench harness to score an interim patch in Docker
(real test runner, real env, real signal), then feeds the test output back
to CodeBot for one more pass if the patch failed.

Imported by gen_predictions.py when --enable-docker-test-loop is set. Off
by default since it adds ~3-5 min and ~$0.30 per task.

Architecture (deliberately small):

    +-------------------------------+
    | gen_predictions main loop     |
    | 1. clone repo                 |
    | 2. invoke codebot → patch_v1  |
    | 3. force-diff retry if empty  |
    | 4. THIS MODULE:               |
    |    a. write patch_v1 to a    |
    |       throwaway predictions  |
    |       file                   |
    |    b. call official harness  |
    |       on it (1 task, 1 run)  |
    |    c. read report.json       |
    |    d. if resolved → done     |
    |    e. if not → read test log │
    |       → invoke codebot again │
    |       with test output       │
    |       appended → patch_v2    │
    | 5. capture final diff        │
    +-------------------------------+

Cost cap: ONE inner Docker eval per task (so worst case = 2 Docker
runs per task: this inner one + the final outer scoring run). Could be
extended to N retries but diminishing returns set in fast.
"""
from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path
from typing import Optional


def score_patch_in_docker(
    instance_id: str,
    model_patch: str,
    model_name_or_path: str,
    bench_dir: Path,
    docker_host: str,
    timeout_sec: int = 600,
) -> tuple[bool, Optional[str], str]:
    """Score a single patch using the official SWE-bench harness in Docker.

    Returns (resolved, test_output_log_path_or_none, summary).

    `resolved` is True only if the official harness report.json says so.
    `test_output_log_path` is the path to the harness's test_output.txt
    for this run (None if scoring failed at infrastructure level).
    `summary` is a short human-readable string for the gen log.
    """
    ts = int(time.time())
    run_id = f"inner-{instance_id.replace('/', '_')}-{ts}"
    pred_path = bench_dir / f"predictions-{run_id}.json"
    pred_path.write_text(json.dumps([{
        "instance_id": instance_id,
        "model_patch": model_patch,
        "model_name_or_path": model_name_or_path,
    }]))

    try:
        proc = subprocess.run(
            ["bash", "eval.sh", pred_path.name, run_id],
            cwd=str(bench_dir),
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            env={"DOCKER_HOST": docker_host, **__import__("os").environ},
        )
    except subprocess.TimeoutExpired:
        pred_path.unlink(missing_ok=True)
        return False, None, f"docker-eval TIMEOUT after {timeout_sec}s"

    pred_path.unlink(missing_ok=True)

    # Locate the per-task report
    report_path = (bench_dir / "logs" / "run_evaluation" / run_id /
                   model_name_or_path / instance_id / "report.json")
    if not report_path.exists():
        # Find test output for diagnostics even on failure
        return False, None, (
            f"docker-eval no report.json (rc={proc.returncode}); "
            f"stderr tail: {proc.stderr[-200:].strip()}"
        )

    try:
        inner = json.loads(report_path.read_text()).get(instance_id, {})
    except (OSError, json.JSONDecodeError) as e:
        return False, None, f"docker-eval report parse error: {e}"

    resolved = bool(inner.get("resolved"))
    test_log = report_path.parent / "test_output.txt"
    test_log_str = str(test_log) if test_log.exists() else None

    ts_status = inner.get("tests_status", {})
    f2p = ts_status.get("FAIL_TO_PASS", {})
    f2p_pass = len(f2p.get("success", []))
    f2p_fail = len(f2p.get("failure", []))
    summary = (
        f"docker-eval: resolved={resolved}, "
        f"FAIL_TO_PASS {f2p_pass} pass / {f2p_fail} fail"
    )
    return resolved, test_log_str, summary


def extract_test_output_tail(log_path: str, max_chars: int = 4000) -> str:
    """Read the harness's test_output.txt and return a useful tail.

    Strips the noisy header and returns roughly the last `max_chars` of
    test runner output. Designed to be appended to a feedback prompt.
    """
    try:
        text = Path(log_path).read_text(errors="replace")
    except OSError:
        return ""
    # Most useful signal is at the end (failure tracebacks, test summary)
    if len(text) <= max_chars:
        return text
    return "...(earlier output truncated)...\n" + text[-max_chars:]
