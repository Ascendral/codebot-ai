from __future__ import annotations

from dataclasses import dataclass

from codeagi.storage.event_log import EpisodicEventLog
from codeagi.storage.manifest import ManifestStore
from codeagi.storage.paths import StoragePaths, resolve_paths
from codeagi.storage.runtime_state import JsonStateStore


@dataclass
class StorageManager:
    paths: StoragePaths
    manifest_store: ManifestStore
    missions: JsonStateStore
    tasks: JsonStateStore
    world_state: JsonStateStore
    working_memory: JsonStateStore
    plans: JsonStateStore
    verifications: JsonStateStore
    critiques: JsonStateStore
    mission_queue: JsonStateStore
    cycle_traces: JsonStateStore
    semantic_memory: JsonStateStore
    procedures: JsonStateStore
    reflections: JsonStateStore
    autonomy_evals: JsonStateStore
    autonomy_reports: JsonStateStore
    world_entities: JsonStateStore
    world_relations: JsonStateStore
    world_snapshots: JsonStateStore
    event_log: EpisodicEventLog

    @classmethod
    def bootstrap(cls) -> "StorageManager":
        paths = resolve_paths()
        paths.ensure_layout()
        manifest_store = ManifestStore(paths.manifest_file)
        return cls(
            paths=paths,
            manifest_store=manifest_store,
            missions=JsonStateStore(paths.missions_file, manifest_store, "runtime.missions"),
            tasks=JsonStateStore(paths.tasks_file, manifest_store, "runtime.tasks"),
            world_state=JsonStateStore(paths.world_state_file, manifest_store, "runtime.world_state"),
            working_memory=JsonStateStore(paths.working_memory_file, manifest_store, "runtime.working_memory"),
            plans=JsonStateStore(paths.plans_file, manifest_store, "runtime.plans"),
            verifications=JsonStateStore(paths.verifications_file, manifest_store, "runtime.verifications"),
            critiques=JsonStateStore(paths.critiques_file, manifest_store, "runtime.critiques"),
            mission_queue=JsonStateStore(paths.mission_queue_file, manifest_store, "runtime.mission_queue"),
            cycle_traces=JsonStateStore(paths.cycle_traces_file, manifest_store, "runtime.cycle_traces"),
            semantic_memory=JsonStateStore(paths.semantic_memory_file, manifest_store, "memory.semantic"),
            procedures=JsonStateStore(paths.procedural_memory_file, manifest_store, "memory.procedural"),
            reflections=JsonStateStore(paths.reflections_file, manifest_store, "memory.reflections"),
            autonomy_evals=JsonStateStore(paths.autonomy_eval_file, manifest_store, "evals.autonomy"),
            autonomy_reports=JsonStateStore(paths.autonomy_report_file, manifest_store, "evals.autonomy_reports"),
            world_entities=JsonStateStore(paths.world_entities_file, manifest_store, "world.entities"),
            world_relations=JsonStateStore(paths.world_relations_file, manifest_store, "world.relations"),
            world_snapshots=JsonStateStore(paths.world_snapshots_file, manifest_store, "world.snapshots"),
            event_log=EpisodicEventLog(paths.event_log_file, manifest_store),
        )
