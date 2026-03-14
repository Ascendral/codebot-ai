from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

from codeagi.core.loop import RuntimeLoop
from codeagi.core.mission import MissionManager
from codeagi.storage.manager import StorageManager


class MissionPersistenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        base = Path(self.temp_dir.name)
        os.environ["CODEAGI_RUNTIME_ROOT"] = str(base / "runtime")
        os.environ["CODEAGI_LONG_TERM_ROOT"] = str(base / "long_term")
        self.storage = StorageManager.bootstrap()
        self.runtime = RuntimeLoop(self.storage)
        self.manager = MissionManager(self.storage)

    def tearDown(self) -> None:
        os.environ.pop("CODEAGI_RUNTIME_ROOT", None)
        os.environ.pop("CODEAGI_LONG_TERM_ROOT", None)
        self.temp_dir.cleanup()

    def test_runtime_init_creates_world_state(self) -> None:
        world_state = self.runtime.initialize()
        self.assertIn("initialized_at", world_state)
        self.assertTrue(self.storage.paths.world_state_file.exists())

    def test_create_mission_persists(self) -> None:
        mission = self.manager.create_mission("Build persistent memory")
        missions = self.manager.list_missions()
        self.assertEqual(len(missions), 1)
        self.assertEqual(missions[0]["id"], mission.id)

    def test_create_task_persists(self) -> None:
        mission = self.manager.create_mission("Build planner")
        task = self.manager.create_task(mission.id, "Define task graph")
        tasks = self.manager.list_tasks(mission.id)
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0]["id"], task.id)

    def test_status_reports_counts(self) -> None:
        mission = self.manager.create_mission("Build evaluator")
        self.manager.create_task(mission.id, "Define benchmarks")
        status = self.runtime.status()
        self.assertEqual(status["snapshot"]["mission_count"], 1)
        self.assertEqual(status["snapshot"]["task_count"], 1)
        self.assertEqual(status["snapshot"]["queue_length"], 1)

    def test_manifest_records_runtime_state(self) -> None:
        self.manager.create_mission("Build runtime")
        manifest = json.loads(self.storage.paths.manifest_file.read_text())
        self.assertIn("runtime.missions", manifest)
