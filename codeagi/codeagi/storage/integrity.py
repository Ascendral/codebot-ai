from __future__ import annotations

import hashlib
from pathlib import Path


class IntegrityManager:
    @staticmethod
    def sha256_bytes(data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()

    @classmethod
    def sha256_text(cls, text: str) -> str:
        return cls.sha256_bytes(text.encode("utf-8"))

    @classmethod
    def sha256_file(cls, path: Path) -> str:
        return cls.sha256_bytes(path.read_bytes())
