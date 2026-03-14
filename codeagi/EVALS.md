# EVALS.md

## Purpose

This document defines how CodeAGI is evaluated.

The goal is to prevent us from confusing:
- fluent output with reasoning
- persistence with memory usefulness
- tool execution with autonomy
- demos with actual capability

## Evaluation Principles

1. Every important claim must map to at least one measurable test.
2. Tests must be repeatable.
3. Improvements must survive multiple runs.
4. Transfer matters more than memorized success.
5. Recovery matters as much as first-pass success.
6. Human impressions are not valid primary evidence.

## Core Capability Areas

We evaluate six areas:
1. task competence
2. memory usefulness
3. autonomy
4. verification and self-correction
5. learning
6. transfer/generalization

## Required Metrics

Track at minimum:
- task success rate
- autonomy horizon
- retrieval precision and recall
- self-detected error rate
- failure recurrence reduction
- transfer score
- recovery rate
- regression count

## Adversarial Testing

We must test:
- misleading observations
- stale memory
- contradictory evidence
- overconfident planner output
- failed tools
- partial environment visibility
- long interruptions
- ambiguous goals

## Minimum Claim Standard

Before claiming a subsystem works, it must show:
- repeatable results
- measurable benefit over baseline
- non-trivial robustness
- no obvious regression in another area

## Standard Question

Did this change make the system measurably better at useful work over time?

If not, it is not intelligence progress.
