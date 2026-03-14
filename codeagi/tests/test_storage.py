from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

from codeagi.storage.manager import StorageManager
from codeagi.storage.paths import resolve_paths


class StorageFoundationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        base = Path(self.temp_dir.name)
        self.runtime_root = base / "runtime"
        self.long_term_root = base / "long_term"
        os.environ["CODEAGI_RUNTIME_ROOT"] = str(self.runtime_root)
        os.environ["CODEAGI_LONG_TERM_ROOT"] = str(self.long_term_root)

    def tearDown(self) -> None:
        os.environ.pop("CODEAGI_RUNTIME_ROOT", None)
        os.environ.pop("CODEAGI_LONG_TERM_ROOT", None)
        self.temp_dir.cleanup()

    def test_resolve_paths_uses_environment(self) -> None:
        paths = resolve_paths()
        self.assertEqual(paths.runtime_root, self.runtime_root.resolve())
        self.assertEqual(paths.long_term_root, self.long_term_root.resolve())

    def test_bootstrap_creates_layout(self) -> None:
        storage = StorageManager.bootstrap()
        self.assertTrue(storage.paths.missions_file.parent.exists())
        self.assertTrue((self.long_term_root / "memory" / "episodic").exists())
        self.assertTrue((self.long_term_root / "manifests").exists())
        self.assertTrue((self.long_term_root / "world" / "entities").exists())

    def test_event_log_records_manifest(self) -> None:
        storage = StorageManager.bootstrap()
        storage.event_log.append("test.event", {"value": 1})
        self.assertTrue(storage.paths.event_log_file.exists())
        manifest = json.loads(storage.paths.manifest_file.read_text())
        self.assertIn("episodic.events", manifest)
