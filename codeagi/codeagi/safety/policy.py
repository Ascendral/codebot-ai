from __future__ import annotations

import shlex


class PolicyEngine:
    SAFE_COMMANDS = {
        "pwd",
        "ls",
        "cat",
        "echo",
        "rg",
        "find",
        "python3",
    }
    BLOCKED_TOKENS = {"rm", "sudo", "mv", "chmod", "chown", "git", "curl", "wget"}
    BLOCKED_CHARS = {";", "&", "|", ">", "<", "`", "$("}

    def check_command(self, command: str | list[str]) -> dict[str, object]:
        if isinstance(command, str):
            if any(token in command for token in self.BLOCKED_CHARS):
                return {
                    "allowed": False,
                    "reason": "Shell metacharacters are blocked for guarded command execution.",
                }
            try:
                parts = shlex.split(command)
            except ValueError:
                return {"allowed": False, "reason": "Command could not be parsed safely."}
        else:
            parts = [str(item) for item in command]

        if not parts:
            return {"allowed": False, "reason": "Command is empty."}
        head = parts[0]
        if head in self.BLOCKED_TOKENS:
            return {"allowed": False, "reason": f"Command '{head}' is not permitted by policy."}
        if head not in self.SAFE_COMMANDS:
            return {"allowed": False, "reason": f"Command '{head}' is outside the allowed safe set."}
        if head == "python3" and len(parts) > 1 and parts[1].startswith("-"):
            return {"allowed": False, "reason": "Arbitrary python flags are blocked by policy."}
        return {"allowed": True, "reason": "Command allowed."}
