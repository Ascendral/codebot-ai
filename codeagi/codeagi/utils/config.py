from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = PACKAGE_ROOT / "config" / "defaults.json"


def _expand(value: str) -> str:
    return os.path.expandvars(os.path.expanduser(value))


def load_defaults() -> dict[str, Any]:
    return json.loads(DEFAULT_CONFIG_PATH.read_text())


def load_config() -> dict[str, Any]:
    config = load_defaults()
    runtime_root = os.getenv("CODEAGI_RUNTIME_ROOT")
    long_term_root = os.getenv("CODEAGI_LONG_TERM_ROOT")
    workspace_root = os.getenv("CODEAGI_WORKSPACE_ROOT")
    max_cycle_steps = os.getenv("CODEAGI_MAX_CYCLE_STEPS")
    if runtime_root:
        config["storage"]["runtime_root"] = _expand(runtime_root)
    else:
        config["storage"]["runtime_root"] = _expand(config["storage"]["runtime_root"])
    if long_term_root:
        config["storage"]["long_term_root"] = _expand(long_term_root)
    else:
        config["storage"]["long_term_root"] = _expand(config["storage"]["long_term_root"])
    if workspace_root:
        config["workspace"]["root"] = _expand(workspace_root)
    else:
        config["workspace"]["root"] = _expand(config["workspace"]["root"])
    if max_cycle_steps:
        config["runtime"]["max_cycle_steps"] = int(max_cycle_steps)
    return config
