from __future__ import annotations

from codeagi.core.state import Reflection
from codeagi.storage.manager import StorageManager


class ReflectionEngine:
    def __init__(self, storage: StorageManager) -> None:
        self.storage = storage

    def load_all(self) -> list[dict[str, object]]:
        return self.storage.reflections.load(default=[])

    def reflect(
        self,
        mission: dict[str, object],
        tasks: list[dict[str, object]],
        working_memory: dict[str, object],
        next_action: dict[str, object],
        action_outcome: dict[str, object],
    ) -> dict[str, object]:
        completed = sum(1 for task in tasks if task["status"] == "completed")
        outstanding = sum(1 for task in tasks if task["status"] != "completed")
        blockers = list(working_memory.get("blockers", []))
        lessons = []
        if blockers:
            lessons.append("Unblock constrained work before adding new execution steps.")
        if outstanding == 0 and tasks:
            lessons.append("The current task list is complete; refresh mission status.")
        if not tasks:
            lessons.append("No tasks exist yet; decomposition is the next meaningful action.")
        reflection = Reflection(
            mission_id=str(mission["id"]),
            active_task_id=working_memory.get("active_task_id"),
            summary=f"Mission '{mission['description']}' is focused on {working_memory['current_focus']}.",
            next_action=str(next_action["description"]),
            action_outcome=str(action_outcome["summary"]),
            completed_tasks=completed,
            outstanding_tasks=outstanding,
            blockers=blockers,
            lessons=lessons,
        )
        return self.save(reflection.to_dict())

    def save(self, reflection: dict[str, object]) -> dict[str, object]:
        reflections = self.load_all()
        reflections.append(reflection)
        self.storage.reflections.save(reflections)
        self.storage.event_log.append(
            "reflection.recorded",
            {
                "mission_id": reflection.get("mission_id"),
                "reflection_id": reflection.get("id"),
                "next_action": reflection.get("next_action"),
            },
        )
        return reflection
