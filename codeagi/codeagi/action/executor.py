from __future__ import annotations

from codeagi.adapters.tool_adapter import ToolAdapter
from codeagi.core.mission import MissionManager
from codeagi.core.state import ActionOutcome
from codeagi.reasoning.planner import Planner
from codeagi.storage.manager import StorageManager


class ActionExecutor:
    def __init__(self, storage: StorageManager) -> None:
        self.storage = storage
        self.missions = MissionManager(storage)
        self.tools = ToolAdapter()
        self.planner = Planner(storage)

    def execute(self, mission: dict[str, object], action: dict[str, object]) -> dict[str, object]:
        action_type = str(action["type"])
        if action_type == "execute_task":
            return self._execute_task(mission, action)
        if action_type == "decompose_mission":
            return self._decompose_mission(mission, action)
        if action_type == "resolve_blocker":
            return self._resolve_blocker(mission, action)
        if action_type == "mission_complete":
            return self._complete_mission(mission, action)
        return self._fail_action(
            mission,
            action,
            summary=f"Action requires replanning: {action['description']}",
        )

    def _execute_task(self, mission: dict[str, object], action: dict[str, object]) -> dict[str, object]:
        task_id = str(action["task_id"])
        task = next((item for item in self.missions.list_tasks(mission["id"]) if item["id"] == task_id), None)
        if task is None:
            return self._fail_action(
                mission,
                action,
                summary=f"Task {task_id} was missing during execution.",
            )
        tool_result = None
        if task.get("action_kind"):
            tool_result = self.tools.execute(str(task["action_kind"]), dict(task.get("action_payload", {})))
            if not tool_result["ok"]:
                self.missions.update_task_status(task_id, "failed", blocked_reason=tool_result["summary"])
                return self._fail_action(
                    mission,
                    action,
                    summary=tool_result["summary"],
                    details=tool_result.get("details", {}),
                )
        self.missions.update_task_status(task_id, "completed")
        tasks = self.missions.list_tasks(mission["id"])
        mission_status = self._update_mission_status_if_complete(mission["id"], tasks)
        self.storage.event_log.append(
            "task.executed",
            {
                "mission_id": mission["id"],
                "task_id": task_id,
                "result": "completed",
                "action_kind": task.get("action_kind"),
            },
        )
        outcome = ActionOutcome(
            status="completed",
            action_type=action["type"],
            summary=f"Completed task: {task['description']}",
            mission_id=str(mission["id"]),
            task_id=task_id,
            task_description=str(task["description"]),
            mission_status=mission_status,
            details=tool_result.get("details", {}) if tool_result else {},
        )
        return outcome.to_dict()

    def _decompose_mission(self, mission: dict[str, object], action: dict[str, object]) -> dict[str, object]:
        drafted = self.planner.draft_task(mission)
        task = self.missions.create_task(
            str(mission["id"]),
            drafted["description"],
            action_kind=drafted["action_kind"],
            action_payload=drafted["action_payload"],
        )
        outcome = ActionOutcome(
            status="generated",
            action_type=action["type"],
            summary=f"Generated task: {task.description}",
            mission_id=str(mission["id"]),
            task_id=task.id,
            generated_task_id=task.id,
            task_description=task.description,
            details={"action_kind": task.action_kind, "action_payload": task.action_payload},
        )
        return outcome.to_dict()

    def _resolve_blocker(self, mission: dict[str, object], action: dict[str, object]) -> dict[str, object]:
        outcome = ActionOutcome(
            status="blocked",
            action_type=action["type"],
            summary=f"Blocker remains: {action['description']}",
            mission_id=str(mission["id"]),
            task_id=action.get("task_id"),
            task_description=str(action["description"]),
            requires_replan=True,
        )
        return outcome.to_dict()

    def _complete_mission(self, mission: dict[str, object], action: dict[str, object]) -> dict[str, object]:
        self.missions.update_mission_status(str(mission["id"]), "completed")
        outcome = ActionOutcome(
            status="completed",
            action_type=action["type"],
            summary=f"Mission completed: {mission['description']}",
            mission_id=str(mission["id"]),
            task_description=str(mission["description"]),
            mission_status="completed",
        )
        return outcome.to_dict()

    def _fail_action(
        self,
        mission: dict[str, object],
        action: dict[str, object],
        *,
        summary: str,
        details: dict[str, object] | None = None,
    ) -> dict[str, object]:
        outcome = ActionOutcome(
            status="failed",
            action_type=action["type"],
            summary=summary,
            mission_id=str(mission["id"]),
            task_id=action.get("task_id"),
            task_description=action.get("description"),
            requires_replan=True,
            details=details or {},
        )
        return outcome.to_dict()

    def _update_mission_status_if_complete(self, mission_id: str, tasks: list[dict[str, object]]) -> str:
        if tasks and all(task["status"] == "completed" for task in tasks):
            self.missions.update_mission_status(mission_id, "completed")
            return "completed"
        return "active"
