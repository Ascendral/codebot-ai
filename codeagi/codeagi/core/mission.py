from __future__ import annotations

from codeagi.core.state import Mission, Task
from codeagi.storage.manager import StorageManager
from codeagi.utils.time import utc_now


class MissionManager:
    def __init__(self, storage: StorageManager) -> None:
        self.storage = storage

    def create_mission(self, description: str, priority: int = 50) -> Mission:
        mission = Mission(description=description, priority=priority)
        missions = self.storage.missions.load(default=[])
        missions.append(mission.to_dict())
        self.storage.missions.save(missions)
        self.storage.event_log.append("mission.created", mission.to_dict())
        return mission

    def list_missions(self) -> list[dict[str, object]]:
        return self.storage.missions.load(default=[])

    def get_mission(self, mission_id: str) -> dict[str, object] | None:
        for mission in self.list_missions():
            if mission["id"] == mission_id:
                return mission
        return None

    def create_task(
        self,
        mission_id: str,
        description: str,
        dependencies: list[str] | None = None,
        action_kind: str | None = None,
        action_payload: dict[str, object] | None = None,
    ) -> Task:
        task = Task(
            mission_id=mission_id,
            description=description,
            dependencies=dependencies or [],
            action_kind=action_kind,
            action_payload=action_payload or {},
        )
        tasks = self.storage.tasks.load(default=[])
        tasks.append(task.to_dict())
        self.storage.tasks.save(tasks)
        self.storage.event_log.append("task.created", task.to_dict())
        return task

    def list_tasks(self, mission_id: str | None = None) -> list[dict[str, object]]:
        tasks = self.storage.tasks.load(default=[])
        if mission_id is None:
            return tasks
        return [task for task in tasks if task["mission_id"] == mission_id]

    def update_task_status(self, task_id: str, status: str, blocked_reason: str | None = None) -> None:
        tasks = self.storage.tasks.load(default=[])
        for task in tasks:
            if task["id"] == task_id:
                task["status"] = status
                task["blocked_reason"] = blocked_reason
                task["updated_at"] = utc_now()
                break
        self.storage.tasks.save(tasks)
        self.storage.event_log.append(
            "task.updated",
            {"task_id": task_id, "status": status, "blocked_reason": blocked_reason},
        )

    def update_mission_status(self, mission_id: str, status: str) -> None:
        missions = self.storage.missions.load(default=[])
        for mission in missions:
            if mission["id"] == mission_id:
                mission["status"] = status
                mission["updated_at"] = utc_now()
                break
        self.storage.missions.save(missions)
        self.storage.event_log.append("mission.updated", {"mission_id": mission_id, "status": status})
