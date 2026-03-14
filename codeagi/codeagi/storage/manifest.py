from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

from codeagi.utils.time import utc_now


@dataclass
class ManifestEntry:
    key: str
    path: str
    sha256: str
    updated_at: str


class ManifestStore:
    def __init__(self, manifest_file: Path) -> None:
        self.manifest_file = manifest_file

    def load(self) -> dict[str, ManifestEntry]:
        if not self.manifest_file.exists():
            return {}
        raw = json.loads(self.manifest_file.read_text())
        return {key: ManifestEntry(**value) for key, value in raw.items()}

    def save(self, entries: dict[str, ManifestEntry]) -> None:
        self.manifest_file.parent.mkdir(parents=True, exist_ok=True)
        payload = {key: asdict(value) for key, value in entries.items()}
        self.manifest_file.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")

    def record(self, key: str, path: Path, sha256: str) -> ManifestEntry:
        entries = self.load()
        entry = ManifestEntry(key=key, path=str(path), sha256=sha256, updated_at=utc_now())
        entries[key] = entry
        self.save(entries)
        return entry
