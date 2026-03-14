from __future__ import annotations

import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path

from codeagi.interfaces.cli import main


class CliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        base = Path(self.temp_dir.name)
        os.environ["CODEAGI_RUNTIME_ROOT"] = str(base / "runtime")
        os.environ["CODEAGI_LONG_TERM_ROOT"] = str(base / "long_term")

    def tearDown(self) -> None:
        os.environ.pop("CODEAGI_RUNTIME_ROOT", None)
        os.environ.pop("CODEAGI_LONG_TERM_ROOT", None)
        self.temp_dir.cleanup()

    def run_cli(self, *args: str) -> dict[str, object]:
        buf = StringIO()
        with redirect_stdout(buf):
            rc = main(list(args))
        self.assertEqual(rc, 0)
        return json.loads(buf.getvalue())

    def test_init_command(self) -> None:
        payload = self.run_cli("init")
        self.assertIn("initialized_at", payload)

    def test_mission_create_command(self) -> None:
        payload = self.run_cli("mission", "create", "Bootstrap cognition")
        self.assertEqual(payload["description"], "Bootstrap cognition")

    def test_status_command(self) -> None:
        self.run_cli("init")
        payload = self.run_cli("status")
        self.assertIn("snapshot", payload)
        self.assertIn("runtime_root", payload)

    def test_run_command(self) -> None:
        self.run_cli("mission", "create", "Bootstrap cognition")
        payload = self.run_cli("run")
        self.assertIn("status", payload)
