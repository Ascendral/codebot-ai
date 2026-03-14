from __future__ import annotations

from codeagi.core.state import WorkingMemory
from codeagi.storage.manager import StorageManager
from codeagi.utils.time import utc_now


class WorkingMemoryManager:
    def __init__(self, storage: StorageManager) -> None:
        self.storage = storage

    def load_all(self) -> dict[str, dict[str, object]]:
        return self.storage.working_memory.load(default={})

    def load(self, mission_id: str) -> dict[str, object] | None:
        return self.load_all().get(mission_id)

    def load_or_create(
        self,
        mission_id: str,
        mission_description: str,
        active_task_id: str | None = None,
    ) -> dict[str, object]:
        existing = self.load(mission_id)
        if existing is not None:
            return existing
        memory = WorkingMemory(
            mission_id=mission_id,
            current_focus=active_task_id or mission_description,
            active_task_id=active_task_id,
            hypotheses=[f"Mission goal: {mission_description}"],
        )
        return self.save(memory.to_dict())

    def save(self, memory: dict[str, object]) -> dict[str, object]:
        state = self.load_all()
        memory["updated_at"] = utc_now()
        mission_id = str(memory["mission_id"])
        state[mission_id] = memory
        self.storage.working_memory.save(state)
        self.storage.event_log.append(
            "working_memory.updated",
            {
                "mission_id": mission_id,
                "focus": memory.get("current_focus"),
                "active_task_id": memory.get("active_task_id"),
            },
        )
        return memory

    def update(
        self,
        mission_id: str,
        *,
        current_focus: str | None = None,
        active_task_id: str | None = None,
        active_plan_id: str | None = None,
        blockers: list[str] | None = None,
        relevant_memories: list[str] | None = None,
        verification_alerts: list[str] | None = None,
        critique_notes: list[str] | None = None,
        last_action: str | None = None,
        hypothesis: str | None = None,
    ) -> dict[str, object]:
        memory = self.load(mission_id)
        if memory is None:
            raise KeyError(f"Missing working memory for mission {mission_id}")
        if current_focus is not None:
            memory["current_focus"] = current_focus
        if active_task_id is not None or "active_task_id" not in memory:
            memory["active_task_id"] = active_task_id
        if active_plan_id is not None:
            memory["active_plan_id"] = active_plan_id
        if blockers is not None:
            memory["blockers"] = blockers
        if relevant_memories is not None:
            memory["relevant_memories"] = relevant_memories
        if verification_alerts is not None:
            memory["verification_alerts"] = verification_alerts
        if critique_notes is not None:
            memory["critique_notes"] = critique_notes
        if last_action is not None:
            memory["last_action"] = last_action
        if hypothesis:
            hypotheses = list(memory.get("hypotheses", []))
            if hypothesis not in hypotheses:
                hypotheses.append(hypothesis)
            memory["hypotheses"] = hypotheses
        return self.save(memory)
