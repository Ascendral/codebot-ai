import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { Orchestrator, OrchestratorConfig, AgentTask } from './orchestrator';

describe('Orchestrator', () => {
  function makeOrchestrator(overrides?: Partial<OrchestratorConfig>) {
    // Minimal mock dependencies
    const policy = { checkToolCall: () => ({ allowed: true }), isToolAllowed: () => true } as any;
    const metrics = { recordEvent: () => {}, getMetrics: () => ({}) } as any;
    return new Orchestrator(policy, metrics, 0, overrides);
  }

  it('creates with default config', () => {
    const orch = makeOrchestrator();
    assert.ok(orch);
  });

  it('creates with custom config', () => {
    const orch = makeOrchestrator({ maxConcurrent: 5, maxChildAgents: 10 });
    assert.ok(orch);
  });

  it('getResults returns empty array initially', () => {
    const orch = makeOrchestrator();
    assert.deepStrictEqual(orch.getResults(), []);
  });

  it('getActiveCount returns 0 initially', () => {
    const orch = makeOrchestrator();
    assert.strictEqual(orch.getActiveCount(), 0);
  });

  it('validateTask rejects tasks at max depth', () => {
    // depth=1 means children can't spawn grandchildren
    const policy = { checkToolCall: () => ({ allowed: true }), isToolAllowed: () => true } as any;
    const metrics = { recordEvent: () => {}, getMetrics: () => ({}) } as any;
    const orch = new Orchestrator(policy, metrics, 1);
    const task: AgentTask = { id: 'test-1', description: 'test task' };
    const valid = orch.validateTask(task);
    assert.ok(!valid, 'Should reject task at max depth');
  });

  it('validateTask accepts tasks at depth 0', () => {
    const orch = makeOrchestrator();
    const task: AgentTask = { id: 'test-1', description: 'test task' };
    const valid = orch.validateTask(task);
    assert.ok(valid, 'Should accept task at depth 0');
  });

  it('enforces maxChildAgents limit', () => {
    const orch = makeOrchestrator({ maxChildAgents: 2 });
    const canAdd1 = orch.canAddChild();
    assert.ok(canAdd1, 'Should allow first child');
  });

  it('formatResults returns string summary', () => {
    const orch = makeOrchestrator();
    const summary = orch.formatResults();
    assert.ok(typeof summary === 'string');
  });
});
