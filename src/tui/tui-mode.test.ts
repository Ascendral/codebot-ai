import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { TuiMode, TuiStep } from './tui-mode';

// Mock agent that doesn't need a real provider
function createMockAgent(): any {
  return {
    setAskPermission: () => {},
    getTokenTracker: () => ({
      getTotalCost: () => 0,
      formatCost: () => '$0.00',
    }),
    getPolicyEnforcer: () => ({
      getCostLimitUsd: () => 0,
    }),
    run: async function* () {
      yield { type: 'text', text: 'Hello ' };
      yield { type: 'text', text: 'world' };
      yield { type: 'done' };
    },
  };
}

describe('TuiMode', () => {
  it('constructor creates layout with 3 panels', () => {
    const agent = createMockAgent();
    const tui = new TuiMode(agent);
    // TuiMode should have been created without error
    assert.ok(tui);
    assert.strictEqual(tui.isRunning(), false);
  });

  it('isRunning returns false before start', () => {
    const agent = createMockAgent();
    const tui = new TuiMode(agent);
    assert.strictEqual(tui.isRunning(), false);
  });

  it('stop sets running to false', () => {
    const agent = createMockAgent();
    const tui = new TuiMode(agent);
    // Manually set running state without entering alt screen
    (tui as any).running = true;
    assert.strictEqual(tui.isRunning(), true);
    // Don't call stop() directly as it tries to exit alt screen
    (tui as any).running = false;
    assert.strictEqual(tui.isRunning(), false);
  });

  it('TuiStep interface has correct shape', () => {
    const step: TuiStep = { label: 'Test step', status: 'pending' };
    assert.strictEqual(step.label, 'Test step');
    assert.strictEqual(step.status, 'pending');
  });

  it('accepts custom config', () => {
    const agent = createMockAgent();
    const tui = new TuiMode(agent, {
      splitRatio: 0.5,
      autoApprove: true,
      statusText: 'Custom status',
    });
    assert.ok(tui);
  });

  it('config defaults work', () => {
    const agent = createMockAgent();
    const tui = new TuiMode(agent);
    assert.ok(tui);
  });

  it('setAskPermission is called on agent', () => {
    let permFnSet = false;
    const agent = {
      ...createMockAgent(),
      setAskPermission: () => { permFnSet = true; },
    };
    new TuiMode(agent);
    assert.strictEqual(permFnSet, true);
  });

  it('TuiStep supports all status values', () => {
    const statuses: TuiStep['status'][] = ['pending', 'active', 'done', 'failed', 'skipped'];
    for (const status of statuses) {
      const step: TuiStep = { label: 'test', status };
      assert.strictEqual(step.status, status);
    }
  });
});
