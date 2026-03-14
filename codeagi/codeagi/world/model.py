from __future__ import annotations

from codeagi.storage.manager import StorageManager
from codeagi.utils.time import utc_now


class WorldModel:
    def __init__(self, storage: StorageManager) -> None:
        self.storage = storage

    def bootstrap(self) -> dict[str, object]:
        current = self.storage.world_state.load(default={})
        if current:
            return current
        baseline = {
            "initialized_at": utc_now(),
            "active_mission_id": None,
            "entity_count": 1,
            "relation_count": 0,
            "snapshot_count": 0,
            "notes": [],
        }
        self.storage.world_entities.save(
            {
                "runtime": {
                    "id": "runtime",
                    "type": "runtime",
                    "name": "CodeAGI Runtime",
                    "status": "initialized",
                    "updated_at": baseline["initialized_at"],
                    "attributes": {"active_mission_id": None},
                }
            }
        )
        self.storage.world_relations.save([])
        self.storage.world_snapshots.save([])
        self.storage.world_state.save(baseline)
        self.storage.event_log.append("world.initialized", baseline)
        return baseline

    def refresh(
        self,
        *,
        missions: list[dict[str, object]],
        tasks: list[dict[str, object]],
        active_mission_id: str | None,
        current_focus: str | None,
        last_plan_id: str | None,
        last_reflection_id: str | None,
        notes: list[str] | None = None,
    ) -> dict[str, object]:
        timestamp = utc_now()
        entities = self._build_entities(missions, tasks, active_mission_id, current_focus, timestamp)
        relations = self._build_relations(missions, tasks, active_mission_id, timestamp)
        existing_snapshots = self.storage.world_snapshots.load(default=[])
        snapshot = {
            "timestamp": timestamp,
            "active_mission_id": active_mission_id,
            "entity_count": len(entities),
            "relation_count": len(relations),
            "mission_ids": [mission["id"] for mission in missions],
            "task_ids": [task["id"] for task in tasks],
            "current_focus": current_focus,
            "last_plan_id": last_plan_id,
            "last_reflection_id": last_reflection_id,
        }
        snapshots = [*existing_snapshots, snapshot]
        self.storage.world_entities.save(entities)
        self.storage.world_relations.save(relations)
        self.storage.world_snapshots.save(snapshots)
        world_state = {
            "initialized_at": self._initialized_at(existing_snapshots, timestamp),
            "active_mission_id": active_mission_id,
            "entity_count": len(entities),
            "relation_count": len(relations),
            "snapshot_count": len(snapshots),
            "last_cycle_at": timestamp,
            "last_plan_id": last_plan_id,
            "last_reflection_id": last_reflection_id,
            "notes": notes or [],
        }
        self.storage.world_state.save(world_state)
        self.storage.event_log.append(
            "world.refreshed",
            {
                "active_mission_id": active_mission_id,
                "entity_count": len(entities),
                "relation_count": len(relations),
                "snapshot_count": len(snapshots),
            },
        )
        return world_state

    def _initialized_at(self, snapshots: list[dict[str, object]], fallback: str) -> str:
        current = self.storage.world_state.load(default={})
        if current.get("initialized_at"):
            return str(current["initialized_at"])
        if snapshots:
            return str(snapshots[0]["timestamp"])
        return fallback

    def _build_entities(
        self,
        missions: list[dict[str, object]],
        tasks: list[dict[str, object]],
        active_mission_id: str | None,
        current_focus: str | None,
        timestamp: str,
    ) -> dict[str, dict[str, object]]:
        entities: dict[str, dict[str, object]] = {
            "runtime": {
                "id": "runtime",
                "type": "runtime",
                "name": "CodeAGI Runtime",
                "status": "active" if active_mission_id else "idle",
                "updated_at": timestamp,
                "attributes": {
                    "active_mission_id": active_mission_id,
                    "current_focus": current_focus,
                    "mission_count": len(missions),
                    "task_count": len(tasks),
                },
            }
        }
        for mission in missions:
            entities[str(mission["id"])] = {
                "id": str(mission["id"]),
                "type": "mission",
                "name": str(mission["description"]),
                "status": str(mission["status"]),
                "updated_at": timestamp,
                "attributes": {
                    "priority": mission["priority"],
                    "created_at": mission["created_at"],
                    "updated_at": mission["updated_at"],
                    "is_active_focus": mission["id"] == active_mission_id,
                },
            }
        for task in tasks:
            entities[str(task["id"])] = {
                "id": str(task["id"]),
                "type": "task",
                "name": str(task["description"]),
                "status": str(task["status"]),
                "updated_at": timestamp,
                "attributes": {
                    "mission_id": task["mission_id"],
                    "blocked_reason": task.get("blocked_reason"),
                    "dependencies": list(task.get("dependencies", [])),
                    "created_at": task["created_at"],
                    "updated_at": task["updated_at"],
                },
            }
        return entities

    def _build_relations(
        self,
        missions: list[dict[str, object]],
        tasks: list[dict[str, object]],
        active_mission_id: str | None,
        timestamp: str,
    ) -> list[dict[str, object]]:
        relations: list[dict[str, object]] = []
        if active_mission_id:
            relations.append(
                {
                    "type": "focuses_on",
                    "from": "runtime",
                    "to": active_mission_id,
                    "status": "active",
                    "updated_at": timestamp,
                }
            )
        mission_ids = {str(mission["id"]) for mission in missions}
        for task in tasks:
            mission_id = str(task["mission_id"])
            if mission_id in mission_ids:
                relations.append(
                    {
                        "type": "has_task",
                        "from": mission_id,
                        "to": str(task["id"]),
                        "status": str(task["status"]),
                        "updated_at": timestamp,
                    }
                )
            for dependency in task.get("dependencies", []):
                relations.append(
                    {
                        "type": "depends_on",
                        "from": str(task["id"]),
                        "to": str(dependency),
                        "status": "declared",
                        "updated_at": timestamp,
                    }
                )
        return relations
