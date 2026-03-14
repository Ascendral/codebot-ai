from __future__ import annotations

import os
from pathlib import Path

from codeagi.utils.config import load_config


def run_doctor() -> dict[str, object]:
    config = load_config()
    runtime_root = Path(config["storage"]["runtime_root"]).resolve()
    long_term_root = Path(config["storage"]["long_term_root"]).resolve()
    workspace_root = Path(config["workspace"]["root"]).resolve()
    max_cycle_steps = int(config["runtime"]["max_cycle_steps"])
    paths = [
        ("runtime_root", runtime_root),
        ("long_term_root", long_term_root),
        ("workspace_root", workspace_root),
    ]
    checks = []
    for label, path in paths:
        path.mkdir(parents=True, exist_ok=True)
        checks.append(
            {
                "name": label,
                "path": str(path),
                "exists": path.exists(),
                "writable": os.access(path, os.W_OK),
            }
        )
    overall_ok = all(check["exists"] and check["writable"] for check in checks)
    return {
        "ok": overall_ok,
        "python_version": os.sys.version.split()[0],
        "max_cycle_steps": max_cycle_steps,
        "checks": checks,
    }
