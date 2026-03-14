from __future__ import annotations

from codeagi.storage.manager import StorageManager
from codeagi.utils.ids import new_id
from codeagi.utils.time import utc_now


class SemanticMemory:
    def __init__(self, storage: StorageManager) -> None:
        self.storage = storage

    def load_all(self) -> list[dict[str, object]]:
        return self.storage.semantic_memory.load(default=[])

    def remember(
        self,
        *,
        mission: dict[str, object],
        reflection: dict[str, object],
        action_outcome: dict[str, object],
    ) -> dict[str, object] | None:
        if action_outcome["status"] not in {"completed", "generated"}:
            return None
        statement = self._build_statement(mission, action_outcome)
        tags = self._extract_tags(mission["description"], action_outcome.get("task_description"))
        existing = self._find_statement(statement)
        memories = self.load_all()
        if existing is not None:
            existing["confidence"] = min(1.0, float(existing.get("confidence", 0.6)) + 0.05)
            existing["updated_at"] = utc_now()
            existing["observations"] = int(existing.get("observations", 1)) + 1
            updated = [existing if item["id"] == existing["id"] else item for item in memories]
            self.storage.semantic_memory.save(updated)
            self.storage.event_log.append(
                "memory.semantic.reinforced",
                {"memory_id": existing["id"], "mission_id": mission["id"]},
            )
            return existing

        entry = {
            "id": new_id("semantic"),
            "mission_id": str(mission["id"]),
            "statement": statement,
            "tags": tags,
            "source_reflection_id": reflection["id"],
            "confidence": 0.65,
            "observations": 1,
            "created_at": utc_now(),
            "updated_at": utc_now(),
        }
        memories.append(entry)
        self.storage.semantic_memory.save(memories)
        self.storage.event_log.append(
            "memory.semantic.created",
            {"memory_id": entry["id"], "mission_id": mission["id"]},
        )
        return entry

    def retrieve(self, query: str, limit: int = 3) -> list[str]:
        query_tags = set(self._extract_tags(query))
        scored = []
        for entry in self.load_all():
            tags = set(entry.get("tags", []))
            overlap = len(query_tags.intersection(tags))
            if overlap:
                scored.append((overlap, float(entry.get("confidence", 0.0)), entry["statement"]))
        scored.sort(reverse=True)
        return [statement for _, _, statement in scored[:limit]]

    def _find_statement(self, statement: str) -> dict[str, object] | None:
        for entry in self.load_all():
            if entry["statement"] == statement:
                return entry
        return None

    def _build_statement(self, mission: dict[str, object], action_outcome: dict[str, object]) -> str:
        if action_outcome.get("task_description"):
            return (
                f"For mission '{mission['description']}', the system can "
                f"{action_outcome['action_type'].replace('_', ' ')} around '{action_outcome['task_description']}'."
            )
        return f"Mission '{mission['description']}' reached outcome: {action_outcome['summary']}."

    def _extract_tags(self, *parts: str | None) -> list[str]:
        tags = set()
        for part in parts:
            if not part:
                continue
            for word in str(part).lower().replace("'", "").split():
                cleaned = "".join(ch for ch in word if ch.isalnum())
                if len(cleaned) > 3:
                    tags.add(cleaned)
        return sorted(tags)
