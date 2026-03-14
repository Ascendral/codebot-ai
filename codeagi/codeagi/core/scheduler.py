from __future__ import annotations

from codeagi.storage.manager import StorageManager
from codeagi.utils.time import utc_now


class Scheduler:
    def __init__(self, storage: StorageManager) -> None:
        self.storage = storage

    def build_queue(
        self,
        missions: list[dict[str, object]],
        tasks_by_mission: dict[str, list[dict[str, object]]],
    ) -> list[dict[str, object]]:
        queue = []
        for mission in missions:
            mission_id = str(mission["id"])
            tasks = tasks_by_mission.get(mission_id, [])
            ready_task_count = self._count_ready_tasks(tasks)
            blocked_task_count = sum(1 for task in tasks if task["status"] == "blocked")
            queue.append(
                {
                    "mission_id": mission_id,
                    "description": mission["description"],
                    "status": mission["status"],
                    "priority": mission["priority"],
                    "ready_task_count": ready_task_count,
                    "blocked_task_count": blocked_task_count,
                    "task_count": len(tasks),
                    "updated_at": utc_now(),
                }
            )
        queue.sort(
            key=lambda item: (
                item["status"] != "active",
                -item["ready_task_count"],
                item["priority"],
                item["blocked_task_count"],
                item["updated_at"],
            )
        )
        self.storage.mission_queue.save(queue)
        self.storage.event_log.append(
            "scheduler.queue.updated",
            {"mission_ids": [item["mission_id"] for item in queue], "queue_length": len(queue)},
        )
        return queue

    def select_next(
        self,
        missions: list[dict[str, object]],
        tasks_by_mission: dict[str, list[dict[str, object]]],
    ) -> dict[str, object] | None:
        queue = self.build_queue(missions, tasks_by_mission)
        for entry in queue:
            if entry["status"] == "active":
                return next((mission for mission in missions if mission["id"] == entry["mission_id"]), None)
        return None

    def _count_ready_tasks(self, tasks: list[dict[str, object]]) -> int:
        completed_ids = {str(task["id"]) for task in tasks if task["status"] == "completed"}
        ready = 0
        for task in tasks:
            if task["status"] not in {"queued", "active"}:
                continue
            dependencies = {str(dep) for dep in task.get("dependencies", [])}
            if dependencies.issubset(completed_ids):
                ready += 1
        return ready
