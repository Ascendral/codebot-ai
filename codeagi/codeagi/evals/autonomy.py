from __future__ import annotations

from codeagi.storage.manager import StorageManager
from codeagi.utils.time import utc_now


class AutonomyEvaluator:
    def __init__(self, storage: StorageManager) -> None:
        self.storage = storage

    def load_runs(self) -> list[dict[str, object]]:
        return self.storage.autonomy_evals.load(default=[])

    def record(
        self,
        *,
        mission: dict[str, object] | None,
        plan: dict[str, object] | None,
        verification: dict[str, object] | None,
        critique: dict[str, object] | None,
        next_action: dict[str, object] | None,
        action_outcome: dict[str, object] | None,
        working_memory: dict[str, object] | None,
        cycle_trace: dict[str, object] | None = None,
    ) -> dict[str, object]:
        prior_runs = self.load_runs()
        mission_runs = [run for run in prior_runs if run.get("mission_id") == (mission or {}).get("id")]
        report = {
            "recorded_at": utc_now(),
            "mission_id": mission["id"] if mission else None,
            "plan_id": plan["id"] if plan else None,
            "verification_valid": bool((verification or {}).get("valid", False)),
            "critique_approved": bool((critique or {}).get("approved", False)),
            "next_action_type": (next_action or {}).get("type"),
            "action_outcome_status": (action_outcome or {}).get("status"),
            "completed_step": bool(action_outcome and action_outcome.get("status") == "completed"),
            "intervention_required": bool(next_action and next_action.get("type") == "replan"),
            "autonomy_horizon": len(mission_runs) + 1,
            "step_count": int((cycle_trace or {}).get("step_count", 0)),
            "stop_reason": (cycle_trace or {}).get("stop_reason"),
            "blocker_count": len((working_memory or {}).get("blockers", [])),
            "verification_alert_count": len((working_memory or {}).get("verification_alerts", [])),
        }
        runs = [*prior_runs, report]
        self.storage.autonomy_evals.save(runs)
        self.storage.event_log.append(
            "eval.autonomy.recorded",
            {
                "mission_id": report["mission_id"],
                "autonomy_horizon": report["autonomy_horizon"],
                "intervention_required": report["intervention_required"],
            },
        )
        return report

    def summarize(self) -> dict[str, object]:
        runs = self.load_runs()
        total_runs = len(runs)
        if total_runs == 0:
            summary = {
                "generated_at": utc_now(),
                "total_runs": 0,
                "completed_steps": 0,
                "successful_run_rate": 0.0,
                "intervention_rate": 0.0,
                "avg_verification_alerts": 0.0,
                "missions_seen": 0,
            }
            self.storage.autonomy_reports.save(summary)
            return summary

        completed_steps = sum(1 for run in runs if run.get("completed_step"))
        interventions = sum(1 for run in runs if run.get("intervention_required"))
        verification_alerts = sum(int(run.get("verification_alert_count", 0)) for run in runs)
        step_count_total = sum(int(run.get("step_count", 0)) for run in runs)
        summary = {
            "generated_at": utc_now(),
            "total_runs": total_runs,
            "completed_steps": completed_steps,
            "successful_run_rate": round(completed_steps / total_runs, 3),
            "intervention_rate": round(interventions / total_runs, 3),
            "avg_verification_alerts": round(verification_alerts / total_runs, 3),
            "avg_steps_per_cycle": round(step_count_total / total_runs, 3),
            "missions_seen": len({run.get("mission_id") for run in runs if run.get("mission_id")}),
            "latest_action_type": runs[-1].get("next_action_type"),
            "latest_outcome_status": runs[-1].get("action_outcome_status"),
        }
        self.storage.autonomy_reports.save(summary)
        self.storage.event_log.append(
            "eval.autonomy.summary",
            {
                "total_runs": summary["total_runs"],
                "successful_run_rate": summary["successful_run_rate"],
            },
        )
        return summary
