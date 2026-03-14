from __future__ import annotations

from codeagi.core.state import Procedure
from codeagi.storage.manager import StorageManager
from codeagi.utils.time import utc_now


class MemoryConsolidator:
    def __init__(self, storage: StorageManager) -> None:
        self.storage = storage

    def load_all(self) -> list[dict[str, object]]:
        return self.storage.procedures.load(default=[])

    def consolidate(
        self,
        *,
        mission: dict[str, object],
        reflection: dict[str, object],
        action_outcome: dict[str, object],
    ) -> dict[str, object] | None:
        if action_outcome["status"] not in {"completed", "generated"}:
            return None
        trigger = self._derive_trigger(mission["description"], action_outcome)
        title = self._derive_title(mission["description"], action_outcome)
        existing = self._find_by_trigger(trigger)
        if existing is not None:
            existing["use_count"] = int(existing.get("use_count", 0)) + 1
            existing["confidence"] = min(1.0, float(existing.get("confidence", 0.5)) + 0.1)
            existing["updated_at"] = utc_now()
            procedures = self.load_all()
            updated = [existing if item["id"] == existing["id"] else item for item in procedures]
            self.storage.procedures.save(updated)
            self.storage.event_log.append(
                "memory.procedure.reinforced",
                {"procedure_id": existing["id"], "mission_id": mission["id"], "trigger": trigger},
            )
            return existing

        procedure = Procedure(
            mission_id=str(mission["id"]),
            title=title,
            trigger=trigger,
            steps=[
                f"Review mission intent: {mission['description']}",
                f"Execute action: {reflection['next_action']}",
                f"Record outcome: {action_outcome['summary']}",
            ],
            source_reflection_id=reflection["id"],
            confidence=0.6 if action_outcome["status"] == "completed" else 0.55,
            use_count=1,
        )
        procedures = self.load_all()
        procedures.append(procedure.to_dict())
        self.storage.procedures.save(procedures)
        self.storage.event_log.append(
            "memory.procedure.created",
            {"procedure_id": procedure.id, "mission_id": mission["id"], "trigger": trigger},
        )
        return procedure.to_dict()

    def retrieve(self, mission_description: str) -> list[str]:
        words = {word.lower() for word in mission_description.split() if len(word) > 3}
        matches = []
        for procedure in self.load_all():
            haystack = f"{procedure['title']} {procedure['trigger']}".lower()
            if any(word in haystack for word in words):
                matches.append(f"{procedure['title']}: {procedure['steps'][1]}")
        return matches[:3]

    def _find_by_trigger(self, trigger: str) -> dict[str, object] | None:
        for procedure in self.load_all():
            if procedure["trigger"] == trigger:
                return procedure
        return None

    def _derive_trigger(self, mission_description: str, action_outcome: dict[str, object]) -> str:
        if action_outcome.get("task_description"):
            return str(action_outcome["task_description"])
        return mission_description

    def _derive_title(self, mission_description: str, action_outcome: dict[str, object]) -> str:
        action_type = str(action_outcome["action_type"]).replace("_", " ")
        return f"{action_type.title()} procedure for {mission_description}"
