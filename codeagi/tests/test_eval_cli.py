from __future__ import annotations

import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path

from codeagi.interfaces.cli import main


class EvalCliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        base = Path(self.temp_dir.name)
        os.environ["CODEAGI_RUNTIME_ROOT"] = str(base / "runtime")
        os.environ["CODEAGI_LONG_TERM_ROOT"] = str(base / "long_term")
        os.environ["CODEAGI_WORKSPACE_ROOT"] = str(base / "workspace")
        os.environ["CODEAGI_MAX_CYCLE_STEPS"] = "3"

    def tearDown(self) -> None:
        for key in [
            "CODEAGI_RUNTIME_ROOT",
            "CODEAGI_LONG_TERM_ROOT",
            "CODEAGI_WORKSPACE_ROOT",
            "CODEAGI_MAX_CYCLE_STEPS",
        ]:
            os.environ.pop(key, None)
        self.temp_dir.cleanup()

    def test_eval_repo_cli_runs_fixture(self) -> None:
        buf = StringIO()
        with redirect_stdout(buf):
            rc = main(["eval", "repo", "--fixture", "repo_search"])
        self.assertEqual(rc, 0)
        payload = json.loads(buf.getvalue())
        self.assertEqual(payload["fixture"], "repo_search")
        self.assertEqual(payload["action_outcome"]["status"], "completed")
