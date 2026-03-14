from __future__ import annotations

from codeagi.storage.manager import StorageManager
from codeagi.utils.time import utc_now


class Verifier:
    def __init__(self, storage: StorageManager) -> None:
        self.storage = storage

    def load_all(self) -> dict[str, dict[str, object]]:
        return self.storage.verifications.load(default={})

    def verify(
        self,
        *,
        mission: dict[str, object],
        tasks: list[dict[str, object]],
        plan: dict[str, object],
        next_action: dict[str, object],
        world_entities: dict[str, dict[str, object]],
        world_relations: list[dict[str, object]],
    ) -> dict[str, object]:
        issues: list[str] = []
        warnings: list[str] = []
        mission_id = str(mission["id"])
        task_ids = {str(task["id"]) for task in tasks}
        if mission_id not in world_entities:
            issues.append(f"Active mission {mission_id} is missing from world entities.")
        for relation in world_relations:
            if relation["type"] == "depends_on" and relation["to"] not in task_ids:
                issues.append(
                    f"Task {relation['from']} depends on missing task {relation['to']}."
                )
        if next_action["type"] == "execute_task":
            task_id = next_action.get("task_id")
            if task_id not in task_ids:
                issues.append(f"Next action references missing task {task_id}.")
            ready_steps = [step for step in plan.get("steps", []) if step["status"] == "ready"]
            if not ready_steps:
                issues.append("Plan selected task execution without any ready steps.")
        if next_action["type"] == "resolve_blocker":
            blocked = [step for step in plan.get("steps", []) if step["status"] == "blocked"]
            if not blocked:
                issues.append("Blocker resolution was selected without blocked steps.")
        if next_action["type"] == "mission_complete":
            incomplete = [task for task in tasks if task["status"] != "completed"]
            if incomplete:
                issues.append("Mission was marked complete while incomplete tasks remain.")
        for step in plan.get("steps", []):
            if step["status"] == "blocked" and not step.get("blocked_reason"):
                warnings.append(f"Blocked plan step {step['id']} does not include a blocked_reason.")
        report = {
            "mission_id": mission_id,
            "plan_id": plan.get("id"),
            "checked_at": utc_now(),
            "valid": not issues,
            "issues": issues,
            "warnings": warnings,
            "next_action_type": next_action["type"],
        }
        return self.save(report)

    def save(self, report: dict[str, object]) -> dict[str, object]:
        payload = self.load_all()
        mission_id = str(report["mission_id"])
        payload[mission_id] = report
        self.storage.verifications.save(payload)
        self.storage.event_log.append(
            "verification.completed",
            {
                "mission_id": mission_id,
                "plan_id": report.get("plan_id"),
                "valid": report.get("valid"),
                "issue_count": len(report.get("issues", [])),
            },
        )
        return report
