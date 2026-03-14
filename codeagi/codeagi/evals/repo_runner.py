from __future__ import annotations

from pathlib import Path

from codeagi.core.loop import RuntimeLoop
from codeagi.core.mission import MissionManager
from codeagi.storage.manager import StorageManager


FIXTURES = {
    "repo_search": {
        "files": {
            "repo/app.py": "def deploy_app():\n    return 'deploy'\n",
            "repo/README.md": "deployment notes\n",
        },
        "mission": {
            "description": "search repo for deploy_app and inspect deployment code",
            "priority": 20,
        },
    },
    "repo_patch": {
        "files": {
            "repo/main.txt": "hello old world\n",
        },
        "mission": {
            "description": "patch repo/main.txt replace old with new",
            "priority": 20,
        },
    },
}


class RepoEvalRunner:
    def __init__(self, storage: StorageManager) -> None:
        self.storage = storage
        self.missions = MissionManager(storage)
        self.runtime = RuntimeLoop(storage)

    def run_fixture(self, name: str) -> dict[str, object]:
        fixture = FIXTURES[name]
        workspace = self.runtime.executor.tools.workspace_root
        self._seed_workspace(workspace, fixture["files"])
        mission = self.missions.create_mission(
            fixture["mission"]["description"],
            priority=fixture["mission"]["priority"],
        )
        payload = self.runtime.run_cycle()
        return {
            "fixture": name,
            "mission_id": mission.id,
            "status": payload["status"],
            "cycle_trace": payload.get("cycle_trace"),
            "action_outcome": payload.get("action_outcome"),
            "mission": payload.get("mission"),
        }

    def _seed_workspace(self, root: Path, files: dict[str, str]) -> None:
        for relative, content in files.items():
            target = (root / relative).resolve()
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content)
