from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from codeagi.storage.integrity import IntegrityManager
from codeagi.storage.manifest import ManifestStore


class JsonStateStore:
    def __init__(self, path: Path, manifest_store: ManifestStore, manifest_key: str) -> None:
        self.path = path
        self.manifest_store = manifest_store
        self.manifest_key = manifest_key

    def load(self, default: Any) -> Any:
        if not self.path.exists():
            return default
        return json.loads(self.path.read_text())

    def save(self, value: Any) -> Any:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
        self.manifest_store.record(
            key=self.manifest_key,
            path=self.path,
            sha256=IntegrityManager.sha256_file(self.path),
        )
        return value
