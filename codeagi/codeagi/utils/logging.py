from __future__ import annotations

from dataclasses import dataclass


@dataclass
class EventLog:
    level: str
    message: str


def info(message: str) -> EventLog:
    return EventLog(level="info", message=message)


def warn(message: str) -> EventLog:
    return EventLog(level="warn", message=message)
