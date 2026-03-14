# CodeAGI

CodeAGI is an experimental autonomous cognition runtime for persistent agent research in digital workspaces.

It is not AGI. It is a serious, test-backed system for exploring whether an agent can become more useful over time through persistent memory, world modeling, planning, verification, reflection, scheduling, guarded execution, and longitudinal evaluation.

## What Works Today

The current runtime is real and exercised by tests:
- persistent mission, task, world-state, queue, memory, and eval storage
- working, semantic, and procedural memory
- world entities, relations, and snapshot history
- planner, verifier, critic, and reflection loop
- guarded multi-step execution with cycle traces
- scheduler-backed mission queue selection
- real workspace actions:
  - read/write/append files
  - list directories
  - safe command execution
  - repo search
  - patch application
- policy checks for command execution
- repeatable repo eval fixtures
- CLI commands for runtime control, diagnostics, and repo evals

## What Is Tested

The test suite currently covers:
- runtime initialization and persistence
- mission/task creation and status tracking
- working memory, plans, critiques, reflections, semantic facts, and procedures
- world-model updates and dependency relations
- guarded command policy
- real file, command, search, and patch execution in a workspace root
- multi-step cycle execution and stop conditions
- repo fixture evaluation

Run it locally:

```bash
cd codeagi
python3 -m pip install --user .
python3 -m unittest discover -s tests -v
```

## Quick Start

### 1. Configure storage and workspace roots

```bash
cp .env.example .env
export CODEAGI_RUNTIME_ROOT="$HOME/CodeAGI/runtime"
export CODEAGI_LONG_TERM_ROOT="$HOME/CodeAGI/long-term"
export CODEAGI_WORKSPACE_ROOT="$HOME/CodeAGI/workspace"
```

If you want long-term memory on the external 4TB drive, override it explicitly:

```bash
export CODEAGI_LONG_TERM_ROOT="/Volumes/CodeAGI-4TB/CodeAGI"
```

### 2. Run diagnostics

```bash
python3 -m pip install --user .
python3 -m codeagi doctor
```

### 3. Initialize and inspect the runtime

```bash
python3 -m codeagi init
python3 -m codeagi status
```

### 4. Create and run missions

```bash
python3 -m codeagi mission create "search repo for deploy_app and inspect deployment code"
python3 -m codeagi run
```

### 5. Run repeatable repo eval fixtures

```bash
python3 -m codeagi eval repo --fixture repo_search
python3 -m codeagi eval repo --fixture repo_patch
```

## CLI Surface

Supported commands:
- `python3 -m codeagi init`
- `python3 -m codeagi status`
- `python3 -m codeagi run`
- `python3 -m codeagi doctor`
- `python3 -m codeagi mission create "..." [--priority N]`
- `python3 -m codeagi mission list`
- `python3 -m codeagi task create <mission_id> "..." [--action-kind ...]`
- `python3 -m codeagi task list`
- `python3 -m codeagi eval repo --fixture repo_search|repo_patch`

## Safety Model

Command execution is intentionally restricted.

Currently allowed command families are limited to a safe set:
- `pwd`
- `ls`
- `cat`
- `echo`
- `rg`
- `find`
- `python3` without arbitrary flags

Commands containing dangerous tokens or shell metacharacters are blocked by policy and fail the task.

## Truth Boundary

CodeAGI does not currently claim:
- human-level intelligence
- AGI
- open-ended autonomy
- unrestricted shell control
- production reliability in hostile or high-risk environments

It does claim, honestly, that the current repo contains a working autonomous-agent research runtime with real execution, real persistence, real evaluation hooks, and real safety constraints.

## Foundation Documents

- [TRUTH.md](./TRUTH.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [EVALS.md](./EVALS.md)
- [V0.md](./V0.md)
- [STORAGE.md](./STORAGE.md)
