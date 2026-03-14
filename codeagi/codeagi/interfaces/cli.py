from __future__ import annotations

import argparse
import json

from codeagi.core.loop import RuntimeLoop
from codeagi.core.mission import MissionManager
from codeagi.evals.repo_runner import FIXTURES, RepoEvalRunner
from codeagi.interfaces.doctor import run_doctor
from codeagi.storage.manager import StorageManager


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="codeagi")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init")
    sub.add_parser("status")
    sub.add_parser("run")
    sub.add_parser("doctor")

    eval_parser = sub.add_parser("eval")
    eval_sub = eval_parser.add_subparsers(dest="eval_command", required=True)
    eval_repo = eval_sub.add_parser("repo")
    eval_repo.add_argument("--fixture", choices=sorted(FIXTURES.keys()), required=True)

    mission = sub.add_parser("mission")
    mission_sub = mission.add_subparsers(dest="mission_command", required=True)
    mission_create = mission_sub.add_parser("create")
    mission_create.add_argument("description")
    mission_create.add_argument("--priority", type=int, default=50)
    mission_sub.add_parser("list")

    task = sub.add_parser("task")
    task_sub = task.add_subparsers(dest="task_command", required=True)
    task_create = task_sub.add_parser("create")
    task_create.add_argument("mission_id")
    task_create.add_argument("description")
    task_create.add_argument("--action-kind")
    task_create.add_argument("--path")
    task_create.add_argument("--content")
    task_create.add_argument("--command")
    task_create.add_argument("--expected")
    task_create.add_argument("--replacement")
    task_sub.add_parser("list")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.command == "doctor":
        payload = run_doctor()
    else:
        storage = StorageManager.bootstrap()
        runtime = RuntimeLoop(storage)
        missions = MissionManager(storage)
        repo_runner = RepoEvalRunner(storage)

        if args.command == "init":
            payload = runtime.initialize()
        elif args.command == "status":
            payload = runtime.status()
        elif args.command == "run":
            payload = runtime.run_cycle()
        elif args.command == "eval" and args.eval_command == "repo":
            payload = repo_runner.run_fixture(args.fixture)
        elif args.command == "mission" and args.mission_command == "create":
            payload = missions.create_mission(args.description, args.priority).to_dict()
        elif args.command == "mission" and args.mission_command == "list":
            payload = missions.list_missions()
        elif args.command == "task" and args.task_command == "create":
            action_payload = {}
            if args.path:
                action_payload["path"] = args.path
            if args.content is not None:
                action_payload["content"] = args.content
            if args.command:
                action_payload["command"] = args.command
            if args.expected is not None:
                action_payload["expected"] = args.expected
            if args.replacement is not None:
                action_payload["replacement"] = args.replacement
            payload = missions.create_task(
                args.mission_id,
                args.description,
                action_kind=args.action_kind,
                action_payload=action_payload,
            ).to_dict()
        elif args.command == "task" and args.task_command == "list":
            payload = missions.list_tasks()
        else:
            raise SystemExit("Unsupported command")

    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
