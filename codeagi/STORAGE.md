# STORAGE.md

## Storage Model

CodeAGI uses two storage tiers:

1. local runtime storage
- active state
- caches
- queues
- temp files
- fast indexes

2. external long-term storage
- episodic memory
- semantic memory
- procedural memory
- self-model history
- world snapshots
- eval runs
- experiment artifacts
- checkpoints
- archives

## Recommended Layout

### Local runtime root

`~/CodeAGI/runtime`

### External long-term root

`/Volumes/<drive>/CodeAGI`

## Directory Layout

```text
long_term_root/
  memory/
    episodic/
    semantic/
    procedural/
    self_model/
    consolidation/
  world/
    snapshots/
    graphs/
    entities/
    relations/
  evals/
    benchmarks/
    runs/
    reports/
    regressions/
  experiments/
    active/
    archived/
  checkpoints/
  datasets/
  archives/
  backups/
  manifests/
  integrity/
```

## Operational Rules

1. If external storage is missing, runtime must fail clearly.
2. Long-term memory must never silently fall back to the wrong disk.
3. Integrity hashes must exist for persisted records.
4. Append-only logs should be preferred for episodes and events.
5. Manifests should record stored objects and hashes.
