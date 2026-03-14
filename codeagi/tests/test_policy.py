from __future__ import annotations

import unittest

from codeagi.safety.policy import PolicyEngine


class PolicyEngineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.policy = PolicyEngine()

    def test_allows_safe_command(self) -> None:
        result = self.policy.check_command("pwd")
        self.assertTrue(result["allowed"])

    def test_blocks_dangerous_command(self) -> None:
        result = self.policy.check_command("rm -rf .")
        self.assertFalse(result["allowed"])

    def test_blocks_shell_metacharacters(self) -> None:
        result = self.policy.check_command("pwd; ls")
        self.assertFalse(result["allowed"])
