from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Literal

from codeagi.utils.ids import new_id
from codeagi.utils.time import utc_now

MissionStatus = Literal["active", "paused", "completed", "failed"]
TaskStatus = Literal["queued", "active", "blocked", "completed", "failed"]
PlanStepStatus = Literal["queued", "ready", "completed", "blocked"]


@dataclass
class Mission:
    description: str
    priority: int = 50
    status: MissionStatus = "active"
    id: str = field(default_factory=lambda: new_id("mission"))
    created_at: str = field(default_factory=utc_now)
    updated_at: str = field(default_factory=utc_now)

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class Task:
    mission_id: str
    description: str
    status: TaskStatus = "queued"
    blocked_reason: str | None = None
    action_kind: str | None = None
    action_payload: dict[str, object] = field(default_factory=dict)
    dependencies: list[str] = field(default_factory=list)
    id: str = field(default_factory=lambda: new_id("task"))
    created_at: str = field(default_factory=utc_now)
    updated_at: str = field(default_factory=utc_now)

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class WorkingMemory:
    mission_id: str
    current_focus: str
    active_task_id: str | None = None
    active_plan_id: str | None = None
    hypotheses: list[str] = field(default_factory=list)
    blockers: list[str] = field(default_factory=list)
    relevant_memories: list[str] = field(default_factory=list)
    verification_alerts: list[str] = field(default_factory=list)
    critique_notes: list[str] = field(default_factory=list)
    last_action: str | None = None
    updated_at: str = field(default_factory=utc_now)

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class PlanStep:
    description: str
    status: PlanStepStatus = "queued"
    task_id: str | None = None
    blocked_reason: str | None = None
    id: str = field(default_factory=lambda: new_id("step"))

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class Plan:
    mission_id: str
    summary: str
    steps: list[PlanStep] = field(default_factory=list)
    id: str = field(default_factory=lambda: new_id("plan"))
    created_at: str = field(default_factory=utc_now)
    updated_at: str = field(default_factory=utc_now)

    def to_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["steps"] = [step.to_dict() for step in self.steps]
        return payload


@dataclass
class Reflection:
    mission_id: str
    summary: str
    next_action: str
    action_outcome: str | None = None
    active_task_id: str | None = None
    completed_tasks: int = 0
    outstanding_tasks: int = 0
    blockers: list[str] = field(default_factory=list)
    lessons: list[str] = field(default_factory=list)
    id: str = field(default_factory=lambda: new_id("reflection"))
    created_at: str = field(default_factory=utc_now)

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class Procedure:
    mission_id: str
    title: str
    trigger: str
    steps: list[str] = field(default_factory=list)
    source_reflection_id: str | None = None
    confidence: float = 0.5
    use_count: int = 0
    id: str = field(default_factory=lambda: new_id("procedure"))
    created_at: str = field(default_factory=utc_now)
    updated_at: str = field(default_factory=utc_now)

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class ActionOutcome:
    status: str
    action_type: str
    summary: str
    mission_id: str
    task_id: str | None = None
    task_description: str | None = None
    generated_task_id: str | None = None
    mission_status: str | None = None
    requires_replan: bool = False
    details: dict[str, object] = field(default_factory=dict)
    created_at: str = field(default_factory=utc_now)

    def to_dict(self) -> dict[str, object]:
        return asdict(self)
