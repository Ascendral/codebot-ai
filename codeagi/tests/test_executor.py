from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from codeagi.action.executor import ActionExecutor
from codeagi.core.mission import MissionManager
from codeagi.storage.manager import StorageManager


class ActionExecutorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        base = Path(self.temp_dir.name)
        os.environ["CODEAGI_RUNTIME_ROOT"] = str(base / "runtime")
        os.environ["CODEAGI_LONG_TERM_ROOT"] = str(base / "long_term")
        os.environ["CODEAGI_WORKSPACE_ROOT"] = str(base / "workspace")
        self.storage = StorageManager.bootstrap()
        self.missions = MissionManager(self.storage)
        self.executor = ActionExecutor(self.storage)
        self.workspace_root = base / "workspace"

    def tearDown(self) -> None:
        os.environ.pop("CODEAGI_RUNTIME_ROOT", None)
        os.environ.pop("CODEAGI_LONG_TERM_ROOT", None)
        os.environ.pop("CODEAGI_WORKSPACE_ROOT", None)
        self.temp_dir.cleanup()

    def test_execute_task_returns_structured_outcome(self) -> None:
        mission = self.missions.create_mission("Execute a task")
        task = self.missions.create_task(mission.id, "Finish work")

        outcome = self.executor.execute(
            mission.to_dict(),
            {"type": "execute_task", "description": task.description, "task_id": task.id},
        )

        updated_mission = self.missions.get_mission(mission.id)
        updated_task = self.missions.list_tasks(mission.id)[0]
        self.assertEqual(outcome["status"], "completed")
        self.assertEqual(outcome["mission_id"], mission.id)
        self.assertEqual(outcome["task_id"], task.id)
        self.assertEqual(outcome["mission_status"], "completed")
        self.assertFalse(outcome["requires_replan"])
        self.assertEqual(updated_task["status"], "completed")
        self.assertEqual(updated_mission["status"], "completed")

    def test_execute_write_file_task_uses_workspace_adapter(self) -> None:
        mission = self.missions.create_mission("Write a file")
        task = self.missions.create_task(
            mission.id,
            "Write mission note",
            action_kind="write_file",
            action_payload={"path": "notes/mission.txt", "content": "hello world"},
        )

        outcome = self.executor.execute(
            mission.to_dict(),
            {"type": "execute_task", "description": task.description, "task_id": task.id},
        )

        target = self.workspace_root / "notes" / "mission.txt"
        self.assertTrue(target.exists())
        self.assertEqual(target.read_text(), "hello world")
        self.assertEqual(outcome["status"], "completed")
        self.assertEqual(outcome["details"]["bytes_written"], 11)

    def test_execute_run_command_task_uses_workspace_adapter(self) -> None:
        mission = self.missions.create_mission("Run a command")
        task = self.missions.create_task(
            mission.id,
            "Print current directory",
            action_kind="run_command",
            action_payload={"command": "pwd"},
        )

        outcome = self.executor.execute(
            mission.to_dict(),
            {"type": "execute_task", "description": task.description, "task_id": task.id},
        )

        self.assertEqual(outcome["status"], "completed")
        self.assertEqual(outcome["details"]["returncode"], 0)
        self.assertIn(str(self.workspace_root), outcome["details"]["stdout"])

    def test_execute_search_files_task_finds_repo_matches(self) -> None:
        source = self.workspace_root / "repo" / "app.py"
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_text("def deploy_app():\n    return 'deploy'\n")
        mission = self.missions.create_mission("Search repo")
        task = self.missions.create_task(
            mission.id,
            "Find deployment code",
            action_kind="search_files",
            action_payload={"path": "repo", "pattern": "deploy_app"},
        )

        outcome = self.executor.execute(
            mission.to_dict(),
            {"type": "execute_task", "description": task.description, "task_id": task.id},
        )

        self.assertEqual(outcome["status"], "completed")
        self.assertEqual(outcome["details"]["matches"], ["repo/app.py"])

    def test_execute_apply_patch_task_updates_file(self) -> None:
        target = self.workspace_root / "repo" / "main.txt"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("hello old world\n")
        mission = self.missions.create_mission("Patch repo")
        task = self.missions.create_task(
            mission.id,
            "Patch greeting",
            action_kind="apply_patch",
            action_payload={
                "path": "repo/main.txt",
                "expected": "old",
                "replacement": "new",
                "content": "hello new world\n",
            },
        )

        outcome = self.executor.execute(
            mission.to_dict(),
            {"type": "execute_task", "description": task.description, "task_id": task.id},
        )

        self.assertEqual(outcome["status"], "completed")
        self.assertEqual(target.read_text(), "hello new world\n")

    def test_decompose_mission_generates_new_task(self) -> None:
        mission = self.missions.create_mission("search repo for deploy_app")

        outcome = self.executor.execute(
            mission.to_dict(),
            {"type": "decompose_mission", "description": "Create first task", "task_id": None},
        )

        tasks = self.missions.list_tasks(mission.id)
        self.assertEqual(outcome["status"], "generated")
        self.assertEqual(len(tasks), 1)
        self.assertEqual(outcome["generated_task_id"], tasks[0]["id"])
        self.assertEqual(tasks[0]["action_kind"], "search_files")
        self.assertEqual(tasks[0]["action_payload"]["pattern"], "deploy_app")

    def test_replan_action_returns_failure_outcome(self) -> None:
        mission = self.missions.create_mission("Handle bad plan")

        outcome = self.executor.execute(
            mission.to_dict(),
            {"type": "replan", "description": "Rebuild the plan", "task_id": None},
        )

        self.assertEqual(outcome["status"], "failed")
        self.assertTrue(outcome["requires_replan"])

    def test_command_policy_blocks_dangerous_run_command_task(self) -> None:
        mission = self.missions.create_mission("Unsafe command")
        task = self.missions.create_task(
            mission.id,
            "Try dangerous command",
            action_kind="run_command",
            action_payload={"command": "rm -rf repo"},
        )

        outcome = self.executor.execute(
            mission.to_dict(),
            {"type": "execute_task", "description": task.description, "task_id": task.id},
        )

        updated_task = self.missions.list_tasks(mission.id)[0]
        self.assertEqual(outcome["status"], "failed")
        self.assertTrue(outcome["requires_replan"])
        self.assertEqual(updated_task["status"], "failed")
