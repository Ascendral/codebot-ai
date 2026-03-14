import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { ContextBus } from './context-bus';
import { SwarmScorer } from './scorer';
import { ROLE_REGISTRY, getToolsForRole, buildRoleSystemPrompt, AgentRole } from './roles';
import { createStrategy } from './strategies';

describe('ContextBus', () => {
  it('creates with empty state', () => {
    const bus = new ContextBus('test-swarm');
    assert.deepStrictEqual(bus.getAllMessages(), []);
  });

  it('posts and retrieves messages', () => {
    const bus = new ContextBus('test-swarm');
    bus.post({ fromAgentId: 'agent-1', fromRole: 'coder', type: 'contribution', target: '*', payload: { summary: 'test', content: 'hello' } });
    const msgs = bus.getAllMessages();
    assert.strictEqual(msgs.length, 1);
    assert.strictEqual(msgs[0].fromAgentId, 'agent-1');
    assert.strictEqual(msgs[0].type, 'contribution');
  });

  it('filters messages by type', () => {
    const bus = new ContextBus('test-swarm');
    bus.post({ fromAgentId: 'agent-1', fromRole: 'coder', type: 'contribution', target: '*', payload: { summary: 's', content: 'work' } });
    bus.post({ fromAgentId: 'agent-1', fromRole: 'coder', type: 'request', target: '*', payload: { summary: 's', content: 'help' } });
    const msgs = bus.getByType('request');
    assert.strictEqual(msgs.length, 1);
    assert.strictEqual(msgs[0].payload.content, 'help');
  });

  it('assigns unique IDs to messages', () => {
    const bus = new ContextBus('test-swarm');
    const m1 = bus.post({ fromAgentId: 'a', fromRole: 'coder', type: 'contribution', target: '*', payload: { summary: 's', content: 'a' } });
    const m2 = bus.post({ fromAgentId: 'b', fromRole: 'coder', type: 'contribution', target: '*', payload: { summary: 's', content: 'b' } });
    assert.notStrictEqual(m1.id, m2.id);
  });
});

describe('Roles', () => {
  it('ROLE_REGISTRY contains expected roles', () => {
    const roles: AgentRole[] = ['architect', 'coder', 'reviewer', 'tester', 'researcher'];
    for (const role of roles) {
      assert.ok(ROLE_REGISTRY[role], `Missing role: ${role}`);
    }
  });

  it('getToolsForRole returns filtered tools', () => {
    const tools = getToolsForRole('coder', []);
    assert.ok(Array.isArray(tools));
  });

  it('buildRoleSystemPrompt returns non-empty string', () => {
    const prompt = buildRoleSystemPrompt('Base prompt here', 'researcher');
    assert.ok(typeof prompt === 'string');
    assert.ok(prompt.length > 20);
  });
});

describe('SwarmScorer', () => {
  it('creates instance', () => {
    const scorer = new SwarmScorer();
    assert.ok(scorer);
  });
});

describe('Strategy creation', () => {
  it('creates debate strategy', () => {
    const s = createStrategy('debate');
    assert.ok(s);
  });

  it('creates pipeline strategy', () => {
    const s = createStrategy('pipeline');
    assert.ok(s);
  });

  it('creates moa strategy', () => {
    const s = createStrategy('moa');
    assert.ok(s);
  });

  it('creates fan-out strategy', () => {
    const s = createStrategy('fan-out');
    assert.ok(s);
  });

  it('creates generator-critic strategy', () => {
    const s = createStrategy('generator-critic');
    assert.ok(s);
  });

  it('throws on unknown strategy', () => {
    assert.throws(() => createStrategy('nonexistent'), /Unknown strategy/);
  });
});
