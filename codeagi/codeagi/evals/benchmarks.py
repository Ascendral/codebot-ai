from __future__ import annotations

from codeagi.evals.repo_runner import FIXTURES

BENCHMARKS = [
    {
        "name": "mission_persistence",
        "question": "Can the system resume an interrupted mission?",
    },
    {
        "name": "memory_usefulness",
        "question": "Does retrieved memory change later behavior?",
    },
    {
        "name": "replanning_after_failure",
        "question": "Can the system recover from a failed substep?",
    },
    {
        "name": "autonomy_horizon",
        "question": "How long can the system sustain goal-directed work without intervention?",
    },
    {
        "name": "task_outcome_progression",
        "question": "Do runtime cycles convert planned work into completed outcomes?",
    },
    {
        "name": "procedural_consolidation",
        "question": "Do successful cycles create reusable procedures that can be recalled later?",
    },
    {
        "name": "semantic_recall",
        "question": "Can the system recall prior factual observations when a related mission appears?",
    },
    {
        "name": "longitudinal_autonomy_reporting",
        "question": "Can the system summarize autonomy trend lines across repeated cycles?",
    },
    {
        "name": "repo_fixture_execution",
        "question": "Can the system solve seeded repository tasks in a repeatable workspace fixture?",
        "fixtures": sorted(FIXTURES.keys()),
    },
]
