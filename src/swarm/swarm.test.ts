import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { ContextBus } from './context-bus';
import { SwarmRouter, ProviderSlot, SwarmStrategyType } from './router';
import { SwarmScorer, AgentScore } from './scorer';
import { ROLE_REGISTRY, getToolsForRole, buildRoleSystemPrompt, AgentRole } from './roles';
import { createStrategy } from './strategies';

describe('ContextBus', () => {
  it('creates with empty state', () => {
    const bus = new ContextBus();
    assert.deepStrictEqual(bus.getAllMessages(), []);
  });

  it('posts and retrieves messages', () => {
    const bus = new ContextBus();
    bus.post('agent-1', 'contribution', { content: 'hello' });
    const msgs = bus.getAllMessages();
    assert.strictEqual(msgs.length, 1);
    assert.strictEqual(msgs[0].fromAgentId, 'agent-1');
    assert.strictEqual(msgs[0].type, 'contribution');
  });

  it('filters messages by agent', () => {
    const bus = new ContextBus();
    bus.post('agent-1', 'contribution', { content: 'a' });
    bus.post('agent-2', 'contribution', { content: 'b' });
    const msgs = bus.getMessagesFrom('agent-1');
    assert.strictEqual(msgs.length, 1);
    assert.strictEqual(msgs[0].payload.content, 'a');
  });

  it('filters messages by type', () => {
    const bus = new ContextBus();
    bus.post('agent-1', 'contribution', { content: 'work' });
    bus.post('agent-1', 'request', { content: 'help' });
    const msgs = bus.getMessagesByType('request');
    assert.strictEqual(msgs.length, 1);
  });
});

describe('Roles', () => {
  it('ROLE_REGISTRY contains expected roles', () => {
    const roles: AgentRole[] = ['lead', 'researcher', 'coder', 'reviewer', 'tester', 'writer'];
    for (const role of roles) {
      assert.ok(ROLE_REGISTRY[role], `Missing role: ${role}`);
    }
  });

  it('getToolsForRole returns array of tool names', () => {
    const tools = getToolsForRole('coder');
    assert.ok(Array.isArray(tools));
    assert.ok(tools.length > 0);
  });

  it('buildRoleSystemPrompt returns non-empty string', () => {
    const prompt = buildRoleSystemPrompt('researcher');
    assert.ok(typeof prompt === 'string');
    assert.ok(prompt.length > 20);
  });
});

describe('SwarmScorer', () => {
  it('creates with empty scores', () => {
    const scorer = new SwarmScorer();
    assert.ok(scorer);
  });

  it('records and retrieves agent score', () => {
    const scorer = new SwarmScorer();
    scorer.recordScore('agent-1', {
      agentId: 'agent-1',
      role: 'coder',
      model: 'gpt-4o',
      quality: 0.8,
      speed: 0.9,
      toolAccuracy: 0.7,
      overall: 0.8,
      factors: [],
    });
    const score = scorer.getScore('agent-1');
    assert.ok(score);
    assert.strictEqual(score!.overall, 0.8);
  });
});

describe('Strategy creation', () => {
  it('creates parallel strategy', () => {
    const strategy = createStrategy('parallel');
    assert.ok(strategy);
  });

  it('creates pipeline strategy', () => {
    const strategy = createStrategy('pipeline');
    assert.ok(strategy);
  });

  it('creates debate strategy', () => {
    const strategy = createStrategy('debate');
    assert.ok(strategy);
  });

  it('creates ensemble strategy', () => {
    const strategy = createStrategy('ensemble');
    assert.ok(strategy);
  });
});
