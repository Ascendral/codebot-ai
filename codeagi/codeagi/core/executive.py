from __future__ import annotations

from dataclasses import dataclass

from codeagi.core.mission import MissionManager
from codeagi.core.scheduler import Scheduler
from codeagi.storage.manager import StorageManager


@dataclass
class ExecutiveSnapshot:
    mission_count: int
    task_count: int
    active_missions: int
    queue_length: int


class Executive:
    def __init__(self, storage: StorageManager) -> None:
        self.storage = storage
        self.missions = MissionManager(storage)
        self.scheduler = Scheduler(storage)

    def snapshot(self) -> ExecutiveSnapshot:
        missions = self.missions.list_missions()
        tasks = self.missions.list_tasks()
        active_missions = sum(1 for mission in missions if mission["status"] == "active")
        tasks_by_mission = {mission["id"]: self.missions.list_tasks(mission["id"]) for mission in missions}
        queue = self.scheduler.build_queue(missions, tasks_by_mission)
        return ExecutiveSnapshot(
            mission_count=len(missions),
            task_count=len(tasks),
            active_missions=active_missions,
            queue_length=len(queue),
        )
