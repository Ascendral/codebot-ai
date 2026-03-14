from __future__ import annotations

import subprocess
from pathlib import Path

from codeagi.safety.policy import PolicyEngine
from codeagi.utils.config import load_config


class ToolAdapter:
    def __init__(self) -> None:
        config = load_config()
        self.workspace_root = Path(config["workspace"]["root"]).resolve()
        self.workspace_root.mkdir(parents=True, exist_ok=True)
        self.policy = PolicyEngine()

    def execute(self, action_kind: str, payload: dict[str, object]) -> dict[str, object]:
        if action_kind == "write_file":
            return self._write_file(payload)
        if action_kind == "append_file":
            return self._append_file(payload)
        if action_kind == "read_file":
            return self._read_file(payload)
        if action_kind == "list_dir":
            return self._list_dir(payload)
        if action_kind == "search_files":
            return self._search_files(payload)
        if action_kind == "apply_patch":
            return self._apply_patch(payload)
        if action_kind == "run_command":
            return self._run_command(payload)
        return {
            "ok": False,
            "summary": f"Unsupported action kind: {action_kind}",
            "details": {"action_kind": action_kind},
        }

    def _write_file(self, payload: dict[str, object]) -> dict[str, object]:
        target = self._resolve_path(str(payload["path"]))
        content = str(payload.get("content", ""))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
        return {
            "ok": True,
            "summary": f"Wrote file {target.relative_to(self.workspace_root)}",
            "details": {"path": str(target), "bytes_written": len(content.encode())},
        }

    def _append_file(self, payload: dict[str, object]) -> dict[str, object]:
        target = self._resolve_path(str(payload["path"]))
        content = str(payload.get("content", ""))
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("a", encoding="utf-8") as handle:
            handle.write(content)
        return {
            "ok": True,
            "summary": f"Appended file {target.relative_to(self.workspace_root)}",
            "details": {"path": str(target), "bytes_appended": len(content.encode())},
        }

    def _read_file(self, payload: dict[str, object]) -> dict[str, object]:
        target = self._resolve_path(str(payload["path"]))
        if not target.exists():
            return {"ok": False, "summary": f"File not found: {target.name}", "details": {"path": str(target)}}
        content = target.read_text()
        return {
            "ok": True,
            "summary": f"Read file {target.relative_to(self.workspace_root)}",
            "details": {"path": str(target), "content": content, "bytes_read": len(content.encode())},
        }

    def _list_dir(self, payload: dict[str, object]) -> dict[str, object]:
        target = self._resolve_path(str(payload.get("path", ".")))
        if not target.exists():
            return {"ok": False, "summary": f"Directory not found: {target.name}", "details": {"path": str(target)}}
        items = sorted(item.name for item in target.iterdir())
        return {
            "ok": True,
            "summary": f"Listed directory {target.relative_to(self.workspace_root)}",
            "details": {"path": str(target), "items": items},
        }

    def _search_files(self, payload: dict[str, object]) -> dict[str, object]:
        target = self._resolve_path(str(payload.get("path", ".")))
        pattern = str(payload["pattern"])
        matches = []
        for file_path in sorted(target.rglob("*")):
            if not file_path.is_file():
                continue
            try:
                content = file_path.read_text()
            except UnicodeDecodeError:
                continue
            if pattern in content:
                matches.append(str(file_path.relative_to(self.workspace_root)))
        return {
            "ok": True,
            "summary": f"Found {len(matches)} file matches for pattern '{pattern}'",
            "details": {"pattern": pattern, "matches": matches, "path": str(target)},
        }

    def _apply_patch(self, payload: dict[str, object]) -> dict[str, object]:
        target = self._resolve_path(str(payload["path"]))
        content = str(payload["content"])
        expected = payload.get("expected")
        replacement = payload.get("replacement")
        if not target.exists():
            return {"ok": False, "summary": f"File not found: {target.name}", "details": {"path": str(target)}}
        original = target.read_text()
        if expected is not None and str(expected) not in original:
            return {
                "ok": False,
                "summary": f"Expected text was not found in {target.relative_to(self.workspace_root)}",
                "details": {"path": str(target), "expected": expected},
            }
        if expected is not None and replacement is not None:
            updated = original.replace(str(expected), str(replacement), 1)
        else:
            updated = content
        target.write_text(updated)
        return {
            "ok": True,
            "summary": f"Patched file {target.relative_to(self.workspace_root)}",
            "details": {"path": str(target), "bytes_written": len(updated.encode())},
        }

    def _run_command(self, payload: dict[str, object]) -> dict[str, object]:
        command = payload["command"]
        cwd = self._resolve_path(str(payload.get("cwd", ".")))
        timeout = int(payload.get("timeout_seconds", 10))
        policy = self.policy.check_command(command)
        if not policy["allowed"]:
            return {
                "ok": False,
                "summary": str(policy["reason"]),
                "details": {"cwd": str(cwd), "command": command},
            }
        shell = isinstance(command, str)
        args = command if shell else [str(item) for item in command]
        completed = subprocess.run(
            args,
            cwd=str(cwd),
            shell=shell,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        ok = completed.returncode == 0
        summary = f"Ran command in {cwd.relative_to(self.workspace_root)} with exit code {completed.returncode}"
        return {
            "ok": ok,
            "summary": summary,
            "details": {
                "cwd": str(cwd),
                "command": command,
                "returncode": completed.returncode,
                "stdout": completed.stdout,
                "stderr": completed.stderr,
            },
        }

    def _resolve_path(self, relative_path: str) -> Path:
        candidate = (self.workspace_root / relative_path).resolve()
        if not self._is_within_workspace(candidate):
            raise ValueError(f"Path escapes workspace root: {relative_path}")
        return candidate

    def _is_within_workspace(self, candidate: Path) -> bool:
        try:
            candidate.relative_to(self.workspace_root)
            return True
        except ValueError:
            return False
