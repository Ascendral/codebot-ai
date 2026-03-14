from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from codeagi.storage.integrity import IntegrityManager
from codeagi.storage.manifest import ManifestStore
from codeagi.utils.time import utc_now


class EpisodicEventLog:
    def __init__(self, event_log_file: Path, manifest_store: ManifestStore) -> None:
        self.event_log_file = event_log_file
        self.manifest_store = manifest_store

    def append(self, event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.event_log_file.parent.mkdir(parents=True, exist_ok=True)
        entry = {
            "timestamp": utc_now(),
            "event_type": event_type,
            "payload": payload,
        }
        line = json.dumps(entry, sort_keys=True)
        with self.event_log_file.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
        self.manifest_store.record(
            key="episodic.events",
            path=self.event_log_file,
            sha256=IntegrityManager.sha256_file(self.event_log_file),
        )
        return entry
