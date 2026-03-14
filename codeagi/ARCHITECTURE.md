# ARCHITECTURE.md

## Purpose

CodeAGI is an experimental autonomous cognition system.

Its purpose is to test whether a software agent can become more capable over time through:
- persistent state
- world modeling
- planning
- verification
- learning
- transfer

This architecture exists to support measurable progress in those areas.
It does not assume AGI.
It does not assume one model call is intelligence.

## Design Principles

1. State over session history
2. Cognition over generation
3. Verification before trust
4. Memory must affect behavior
5. Learning must be measurable
6. Modularity over magic

## Top-Level System

CodeAGI is composed of these layers:
1. Executive Layer
2. Memory Layer
3. World Model Layer
4. Reasoning Layer
5. Action Layer
6. Learning Layer
7. Safety Layer
8. Evaluation Layer

## Executive Layer

Owns goals, priorities, and active missions.

Core modules:
- `GoalManager`
- `MissionManager`
- `TaskGraph`
- `Scheduler`
- `ExecutiveState`

## Memory Layer

Stores prior experience, reusable knowledge, and self-model state.

Memory types:
- working memory
- episodic memory
- semantic memory
- procedural memory
- self-model

Core modules:
- `WorkingMemory`
- `EpisodeStore`
- `KnowledgeStore`
- `ProcedureStore`
- `SelfModel`
- `MemoryRetriever`
- `MemoryConsolidator`

## World Model Layer

Represents environment state, entities, relationships, and uncertainty.

Core modules:
- `WorldState`
- `EntityGraph`
- `RelationStore`
- `EnvironmentState`
- `UncertaintyTracker`
- `ChangeTracker`

## Reasoning Layer

Turns goals, memory, and world state into candidate actions and beliefs.

Core modules:
- `Planner`
- `HypothesisEngine`
- `Critic`
- `Verifier`
- `ContradictionDetector`
- `AbstractionEngine`

## Action Layer

Executes bounded actions and captures structured observations.

Core modules:
- `ToolRouter`
- `ActionExecutor`
- `ObservationCollector`
- `SimulationSandbox`
- `RecoveryManager`

## Learning Layer

Improves future behavior from prior outcomes.

Core modules:
- `EpisodeAnalyzer`
- `FailureAnalyzer`
- `SkillExtractor`
- `StrategyOptimizer`
- `BeliefUpdater`

## Safety Layer

Constrains action and gates high-risk behavior.

Core modules:
- `PolicyEngine`
- `RiskScorer`
- `BoundaryGuard`
- `AutonomyGovernor`
- `InterpretabilityLog`

## Evaluation Layer

Determines whether the system is actually improving.

Core modules:
- `BenchmarkRunner`
- `AutonomyEval`
- `MemoryEval`
- `TransferEval`
- `RecoveryEval`
- `RegressionTracker`

## Canonical Loop

1. observe
2. update world state
3. retrieve relevant memory
4. refine active goals
5. generate plans
6. critique and verify
7. act
8. observe outcomes
9. analyze episode
10. consolidate learning

## Success Condition

The architecture is successful only if it produces systems that are measurably:
- more persistent
- more adaptive
- more self-correcting
- more transferable
- more autonomous over time
