from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

from codeagi.core.loop import RuntimeLoop
from codeagi.core.mission import MissionManager
from codeagi.storage.manager import StorageManager


class CognitionLoopTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        base = Path(self.temp_dir.name)
        os.environ["CODEAGI_RUNTIME_ROOT"] = str(base / "runtime")
        os.environ["CODEAGI_LONG_TERM_ROOT"] = str(base / "long_term")
        os.environ["CODEAGI_MAX_CYCLE_STEPS"] = "3"
        self.storage = StorageManager.bootstrap()
        self.runtime = RuntimeLoop(self.storage)
        self.missions = MissionManager(self.storage)

    def tearDown(self) -> None:
        os.environ.pop("CODEAGI_RUNTIME_ROOT", None)
        os.environ.pop("CODEAGI_LONG_TERM_ROOT", None)
        os.environ.pop("CODEAGI_MAX_CYCLE_STEPS", None)
        self.temp_dir.cleanup()

    def test_run_cycle_returns_idle_without_missions(self) -> None:
        payload = self.runtime.run_cycle()
        self.assertEqual(payload["status"], "idle")
        self.assertIsNone(payload["world_state"]["active_mission_id"])
        self.assertEqual(payload["world_state"]["entity_count"], 1)

    def test_run_cycle_persists_working_memory_plan_and_reflection(self) -> None:
        mission = self.missions.create_mission("Build planner")
        task = self.missions.create_task(mission.id, "Define executable milestones")
        payload = self.runtime.run_cycle()

        self.assertEqual(payload["status"], "active")
        self.assertEqual(payload["mission"]["id"], mission.id)
        self.assertEqual(payload["next_action"]["task_id"], task.id)
        self.assertEqual(payload["plan"]["mission_id"], mission.id)
        self.assertEqual(payload["working_memory"]["active_plan_id"], payload["plan"]["id"])
        self.assertEqual(payload["reflection"]["mission_id"], mission.id)
        self.assertTrue(payload["verification"]["valid"])
        self.assertTrue(payload["critique"]["approved"])
        self.assertEqual(payload["action_outcome"]["status"], "completed")
        self.assertIsNotNone(payload["semantic_fact"])
        self.assertIsNotNone(payload["procedure"])
        self.assertIsNotNone(payload["cycle_trace"])
        self.assertEqual(payload["autonomy_eval"]["mission_id"], mission.id)
        self.assertGreaterEqual(payload["autonomy_report"]["total_runs"], 1)
        self.assertIn("runtime", payload["world_entities"])
        self.assertTrue(payload["world_relations"])

        working_memory_state = self.storage.working_memory.load(default={})
        plans = self.storage.plans.load(default={})
        verifications = self.storage.verifications.load(default={})
        critiques = self.storage.critiques.load(default={})
        semantic_memory = self.storage.semantic_memory.load(default=[])
        procedures = self.storage.procedures.load(default=[])
        reflections = self.storage.reflections.load(default=[])
        autonomy_runs = self.storage.autonomy_evals.load(default=[])
        autonomy_report = self.storage.autonomy_reports.load(default={})
        entities = self.storage.world_entities.load(default={})
        relations = self.storage.world_relations.load(default=[])
        snapshots = self.storage.world_snapshots.load(default=[])
        self.assertIn(mission.id, working_memory_state)
        self.assertIn(mission.id, plans)
        self.assertIn(mission.id, verifications)
        self.assertIn(mission.id, critiques)
        self.assertTrue(semantic_memory)
        self.assertTrue(procedures)
        self.assertTrue(reflections)
        self.assertTrue(autonomy_runs)
        self.assertTrue(autonomy_report)
        self.assertIn(mission.id, entities)
        self.assertTrue(relations)
        self.assertTrue(snapshots)

    def test_planner_marks_dependency_blocked_until_prerequisite_is_complete(self) -> None:
        mission = self.missions.create_mission("Build runtime")
        first = self.missions.create_task(mission.id, "Model mission state")
        second = self.missions.create_task(mission.id, "Execute mission cycle", dependencies=[first.id])

        payload = self.runtime.run_cycle()
        tasks = {task["id"]: task for task in self.missions.list_tasks(mission.id)}
        cycle_steps = payload["cycle_trace"]["steps"]

        self.assertEqual(cycle_steps[0]["next_action"]["task_id"], first.id)
        self.assertEqual(cycle_steps[1]["next_action"]["task_id"], second.id)
        self.assertEqual(tasks[first.id]["status"], "completed")
        self.assertEqual(tasks[second.id]["status"], "completed")

    def test_status_surfaces_active_cognitive_state(self) -> None:
        mission = self.missions.create_mission("Build reflection")
        self.missions.create_task(mission.id, "Capture episode lessons")
        self.runtime.run_cycle()

        status = self.runtime.status()
        self.assertIsNotNone(status["active_plan"])
        self.assertIsNotNone(status["latest_verification"])
        self.assertIsNotNone(status["latest_critique"])
        self.assertTrue(status["mission_queue"])
        self.assertIsNotNone(status["latest_cycle_trace"])
        self.assertTrue(status["semantic_memory"])
        self.assertTrue(status["procedures"])
        self.assertIsNotNone(status["working_memory"])
        self.assertIsNotNone(status["latest_reflection"])
        self.assertIsNotNone(status["latest_autonomy_eval"])
        self.assertTrue(status["autonomy_report"])
        self.assertIn("runtime", status["world_entities"])
        self.assertTrue(status["world_relations"])

    def test_manifest_tracks_new_cognitive_state_files(self) -> None:
        mission = self.missions.create_mission("Build memory")
        self.missions.create_task(mission.id, "Persist focus")
        self.runtime.run_cycle()

        manifest = json.loads(self.storage.paths.manifest_file.read_text())
        self.assertIn("runtime.working_memory", manifest)
        self.assertIn("runtime.plans", manifest)
        self.assertIn("runtime.verifications", manifest)
        self.assertIn("runtime.critiques", manifest)
        self.assertIn("runtime.cycle_traces", manifest)
        self.assertIn("memory.semantic", manifest)
        self.assertIn("memory.procedural", manifest)
        self.assertIn("memory.reflections", manifest)
        self.assertIn("evals.autonomy", manifest)
        self.assertIn("evals.autonomy_reports", manifest)
        self.assertIn("world.entities", manifest)
        self.assertIn("world.relations", manifest)
        self.assertIn("world.snapshots", manifest)

    def test_world_model_tracks_dependencies_and_active_focus(self) -> None:
        mission = self.missions.create_mission("Build world model")
        first = self.missions.create_task(mission.id, "Create mission entity")
        second = self.missions.create_task(mission.id, "Link task dependency", dependencies=[first.id])

        payload = self.runtime.run_cycle()
        runtime_entity = payload["world_entities"]["runtime"]
        dependency_relations = [
            relation for relation in payload["world_relations"] if relation["type"] == "depends_on"
        ]

        self.assertEqual(runtime_entity["attributes"]["active_mission_id"], mission.id)
        self.assertEqual(runtime_entity["attributes"]["current_focus"], payload["working_memory"]["current_focus"])
        self.assertEqual(len(dependency_relations), 1)
        self.assertEqual(dependency_relations[0]["from"], second.id)
        self.assertEqual(dependency_relations[0]["to"], first.id)

    def test_verifier_and_critic_reject_missing_dependency_targets(self) -> None:
        mission = self.missions.create_mission("Check invalid world state")
        self.missions.create_task(mission.id, "Execute impossible task", dependencies=["task_missing"])

        payload = self.runtime.run_cycle()

        self.assertFalse(payload["verification"]["valid"])
        self.assertFalse(payload["critique"]["approved"])
        self.assertEqual(payload["next_action"]["type"], "replan")
        self.assertEqual(payload["action_outcome"]["status"], "failed")
        self.assertTrue(payload["working_memory"]["verification_alerts"])
        self.assertTrue(payload["working_memory"]["critique_notes"])

    def test_run_cycle_completes_task_and_mission(self) -> None:
        mission = self.missions.create_mission("Close mission")
        task = self.missions.create_task(mission.id, "Finish the only task")

        payload = self.runtime.run_cycle()
        updated_task = next(item for item in self.missions.list_tasks(mission.id) if item["id"] == task.id)
        updated_mission = self.missions.get_mission(mission.id)

        self.assertEqual(payload["action_outcome"]["task_id"], task.id)
        self.assertEqual(updated_task["status"], "completed")
        self.assertEqual(updated_mission["status"], "completed")
        self.assertEqual(payload["cycle_trace"]["stop_reason"], "mission_completed")

    def test_consolidated_procedure_is_retrieved_on_later_cycle(self) -> None:
        first_mission = self.missions.create_mission("Build planner")
        self.missions.create_task(first_mission.id, "Define executable milestones")
        self.runtime.run_cycle()

        second_mission = self.missions.create_mission("Build planner automation")
        self.missions.create_task(second_mission.id, "Define executable milestones")
        payload = self.runtime.run_cycle()

        relevant = payload["working_memory"]["relevant_memories"]
        self.assertTrue(any("procedure" in item.lower() for item in relevant))

    def test_semantic_memory_is_retrieved_on_later_cycle(self) -> None:
        first_mission = self.missions.create_mission("Map deployment workflow")
        self.missions.create_task(first_mission.id, "Capture deployment outcome")
        self.runtime.run_cycle()

        second_mission = self.missions.create_mission("Map deployment strategy")
        self.missions.create_task(second_mission.id, "Capture deployment outcome")
        payload = self.runtime.run_cycle()

        relevant = payload["working_memory"]["relevant_memories"]
        self.assertTrue(any("mission" in item.lower() and "deployment" in item.lower() for item in relevant))

    def test_autonomy_eval_tracks_repeated_cycles(self) -> None:
        mission = self.missions.create_mission("Track autonomy")
        self.missions.create_task(mission.id, "Finish step one")
        self.runtime.run_cycle()

        second_mission = self.missions.create_mission("Track autonomy followup")
        self.missions.create_task(second_mission.id, "Finish step two")
        payload = self.runtime.run_cycle()

        self.assertGreaterEqual(payload["autonomy_eval"]["autonomy_horizon"], 1)
        self.assertTrue(payload["autonomy_eval"]["completed_step"])
        self.assertGreaterEqual(payload["autonomy_report"]["total_runs"], 2)
        self.assertIn("avg_steps_per_cycle", payload["autonomy_report"])
        self.assertIn("successful_run_rate", payload["autonomy_report"])

    def test_scheduler_prefers_ready_mission_over_blocked_mission(self) -> None:
        blocked = self.missions.create_mission("Blocked mission", priority=10)
        ready = self.missions.create_mission("Ready mission", priority=50)
        first = self.missions.create_task(blocked.id, "Missing dependency", dependencies=["task_missing"])
        self.missions.create_task(ready.id, "Executable step")

        payload = self.runtime.run_cycle()

        self.assertEqual(payload["mission"]["id"], ready.id)
        self.assertTrue(payload["mission_queue"])
        self.assertEqual(payload["mission_queue"][0]["mission_id"], ready.id)

    def test_multi_step_cycle_completes_multiple_ready_tasks_within_budget(self) -> None:
        mission = self.missions.create_mission("Batch mission")
        first = self.missions.create_task(mission.id, "First ready step")
        second = self.missions.create_task(mission.id, "Second ready step")

        payload = self.runtime.run_cycle()
        tasks = self.missions.list_tasks(mission.id)

        self.assertTrue(all(task["status"] == "completed" for task in tasks))
        self.assertEqual(payload["cycle_trace"]["step_count"], 2)
        self.assertEqual(payload["cycle_trace"]["stop_reason"], "mission_completed")

    def test_multi_step_cycle_stops_on_replan_signal(self) -> None:
        mission = self.missions.create_mission("Invalid dependency mission")
        self.missions.create_task(mission.id, "Broken task", dependencies=["task_missing"])
        self.missions.create_task(mission.id, "Ready followup")

        payload = self.runtime.run_cycle()

        self.assertEqual(payload["cycle_trace"]["step_count"], 1)
        self.assertEqual(payload["cycle_trace"]["stop_reason"], "replan_requested")
