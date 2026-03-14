from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from codeagi.utils.config import load_config


@dataclass
class StoragePaths:
    runtime_root: Path
    long_term_root: Path

    @property
    def missions_file(self) -> Path:
        return self.runtime_root / "state" / "missions.json"

    @property
    def tasks_file(self) -> Path:
        return self.runtime_root / "state" / "tasks.json"

    @property
    def world_state_file(self) -> Path:
        return self.runtime_root / "state" / "world_state.json"

    @property
    def working_memory_file(self) -> Path:
        return self.runtime_root / "working_memory" / "active.json"

    @property
    def plans_file(self) -> Path:
        return self.runtime_root / "queue" / "plans.json"

    @property
    def verifications_file(self) -> Path:
        return self.runtime_root / "queue" / "verifications.json"

    @property
    def critiques_file(self) -> Path:
        return self.runtime_root / "queue" / "critiques.json"

    @property
    def mission_queue_file(self) -> Path:
        return self.runtime_root / "queue" / "missions.json"

    @property
    def cycle_traces_file(self) -> Path:
        return self.runtime_root / "logs" / "cycle_traces.json"

    @property
    def event_log_file(self) -> Path:
        return self.long_term_root / "memory" / "episodic" / "events.jsonl"

    @property
    def semantic_memory_file(self) -> Path:
        return self.long_term_root / "memory" / "semantic" / "facts.json"

    @property
    def procedural_memory_file(self) -> Path:
        return self.long_term_root / "memory" / "procedural" / "skills.json"

    @property
    def reflections_file(self) -> Path:
        return self.long_term_root / "memory" / "consolidation" / "reflections.json"

    @property
    def autonomy_eval_file(self) -> Path:
        return self.long_term_root / "evals" / "runs" / "autonomy.json"

    @property
    def autonomy_report_file(self) -> Path:
        return self.long_term_root / "evals" / "reports" / "autonomy_summary.json"

    @property
    def world_entities_file(self) -> Path:
        return self.long_term_root / "world" / "entities" / "active.json"

    @property
    def world_relations_file(self) -> Path:
        return self.long_term_root / "world" / "relations" / "active.json"

    @property
    def world_snapshots_file(self) -> Path:
        return self.long_term_root / "world" / "snapshots" / "history.json"

    @property
    def manifest_file(self) -> Path:
        return self.long_term_root / "manifests" / "objects.json"

    @property
    def integrity_dir(self) -> Path:
        return self.long_term_root / "integrity"

    def ensure_layout(self) -> None:
        runtime_dirs = [
            self.runtime_root / "state",
            self.runtime_root / "cache",
            self.runtime_root / "queue",
            self.runtime_root / "working_memory",
            self.runtime_root / "temp",
            self.runtime_root / "logs",
        ]
        long_term_dirs = [
            self.long_term_root / "memory" / "episodic",
            self.long_term_root / "memory" / "semantic",
            self.long_term_root / "memory" / "procedural",
            self.long_term_root / "memory" / "self_model",
            self.long_term_root / "memory" / "consolidation",
            self.long_term_root / "world" / "snapshots",
            self.long_term_root / "world" / "graphs",
            self.long_term_root / "world" / "entities",
            self.long_term_root / "world" / "relations",
            self.long_term_root / "evals" / "benchmarks",
            self.long_term_root / "evals" / "runs",
            self.long_term_root / "evals" / "reports",
            self.long_term_root / "evals" / "regressions",
            self.long_term_root / "experiments" / "active",
            self.long_term_root / "experiments" / "archived",
            self.long_term_root / "checkpoints",
            self.long_term_root / "datasets",
            self.long_term_root / "archives",
            self.long_term_root / "backups",
            self.long_term_root / "manifests",
            self.long_term_root / "integrity",
        ]
        for directory in [*runtime_dirs, *long_term_dirs]:
            try:
                directory.mkdir(parents=True, exist_ok=True)
            except PermissionError as exc:
                raise RuntimeError(
                    f"Unable to create storage directory '{directory}'. "
                    "Check CODEAGI_RUNTIME_ROOT / CODEAGI_LONG_TERM_ROOT permissions and mount availability."
                ) from exc
            except FileNotFoundError as exc:
                raise RuntimeError(
                    f"Storage root for '{directory}' is unavailable. "
                    "Check CODEAGI_RUNTIME_ROOT / CODEAGI_LONG_TERM_ROOT configuration."
                ) from exc


def resolve_paths() -> StoragePaths:
    config = load_config()
    return StoragePaths(
        runtime_root=Path(config["storage"]["runtime_root"]).resolve(),
        long_term_root=Path(config["storage"]["long_term_root"]).resolve(),
    )
