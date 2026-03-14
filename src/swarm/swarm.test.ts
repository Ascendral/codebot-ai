import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { ContextBus, BusBridgeTool } from './context-bus';
import { ROLE_REGISTRY, getToolsForRole, buildRoleSystemPrompt, AgentRole } from './roles';
import {
  createStrategy, PipelineStrategy, DebateStrategy, MoAStrategy,
  FanOutGatherStrategy, GeneratorCriticStrategy,
  SwarmAgent, AgentRunResult, SwarmEvent, AgentContribution,
} from './strategies';
import { SwarmScorer } from './scorer';
import { SwarmRouter, ProviderSlot } from './router';

function makeStubAgent(id: string, role: AgentRole, output = 'done'): SwarmAgent {
  return {
    id, role, model: 'test-model', providerName: 'test', status: 'idle' as const, depth: 0,
    async run(_prompt: string): Promise<AgentRunResult> {
      return { output, toolCalls: ['read_file'], filesModified: [], durationMs: 50, tokenUsage: { input: 100, output: 200 }, errors: 0 };
    },
  };
}

// -- ContextBus Tests --

describe('ContextBus — core messaging', () => {
  it('creates with empty state', () => {
    const bus = new ContextBus('test-swarm');
    assert.deepStrictEqual(bus.getAllMessages(), []);
  });

  it('posts and retrieves messages', () => {
    const bus = new ContextBus('test-swarm');
    const msg = bus.post({ fromAgentId: 'a1', fromRole: 'coder', type: 'contribution', target: '*', payload: { summary: 'test', content: 'hello' } });
    assert.ok(msg.id.startsWith('msg_'));
    assert.strictEqual(msg.swarmId, 'test-swarm');
    assert.strictEqual(bus.getMessageCount(), 1);
  });

  it('filters by type and round', () => {
    const bus = new ContextBus('s1');
    bus.post({ fromAgentId: 'a1', fromRole: 'coder', type: 'contribution', target: '*', payload: { summary: 's', content: 'c' }, round: 1 });
    bus.post({ fromAgentId: 'a1', fromRole: 'coder', type: 'vote', target: '*', payload: { summary: 'v', content: 'approve' }, round: 1 });
    bus.post({ fromAgentId: 'a2', fromRole: 'reviewer', type: 'contribution', target: '*', payload: { summary: 's2', content: 'c2' }, round: 2 });
    assert.strictEqual(bus.getByType('contribution', 1).length, 1);
    assert.strictEqual(bus.getByType('vote').length, 1);
    assert.strictEqual(bus.getByType('contribution').length, 2);
  });

  it('filters by role', () => {
    const bus = new ContextBus('s1');
    bus.post({ fromAgentId: 'a1', fromRole: 'coder', type: 'contribution', target: '*', payload: { summary: 's', content: 'c' } });
    bus.post({ fromAgentId: 'a2', fromRole: 'reviewer', type: 'contribution', target: '*', payload: { summary: 's', content: 'c' } });
    assert.strictEqual(bus.getByRole('coder').length, 1);
    assert.strictEqual(bus.getByRole('reviewer').length, 1);
  });

  it('assigns unique IDs to messages', () => {
    const bus = new ContextBus('test-swarm');
    const m1 = bus.post({ fromAgentId: 'a', fromRole: 'coder', type: 'contribution', target: '*', payload: { summary: 's', content: 'a' } });
    const m2 = bus.post({ fromAgentId: 'b', fromRole: 'coder', type: 'contribution', target: '*', payload: { summary: 's', content: 'b' } });
    assert.notStrictEqual(m1.id, m2.id);
  });

  it('evicts oldest messages when exceeding maxMessages', () => {
    const bus = new ContextBus('s1', 3);
    for (let i = 0; i < 5; i++) {
      bus.post({ fromAgentId: 'a1', fromRole: 'coder', type: 'contribution', target: '*', payload: { summary: `msg${i}`, content: `c${i}` } });
    }
    assert.strictEqual(bus.getMessageCount(), 3);
    const all = bus.getAllMessages();
    assert.ok(all[0].payload.summary === 'msg2');
  });

  it('clear removes all messages', () => {
    const bus = new ContextBus('s1');
    bus.post({ fromAgentId: 'a1', fromRole: 'coder', type: 'contribution', target: '*', payload: { summary: 's', content: 'c' } });
    bus.clear();
    assert.strictEqual(bus.getMessageCount(), 0);
  });

  it('subscribe receives targeted messages and skips own', () => {
    const bus = new ContextBus('s1');
    const received: unknown[] = [];
    bus.subscribe('a1', 'coder', (msg) => received.push(msg));

    // Own message — should be skipped
    bus.post({ fromAgentId: 'a1', fromRole: 'coder', type: 'contribution', target: '*', payload: { summary: 's', content: 'own' } });
    // Broadcast from other agent
    bus.post({ fromAgentId: 'a2', fromRole: 'reviewer', type: 'feedback', target: '*', payload: { summary: 's', content: 'feedback' } });
    // Targeted at agent
    bus.post({ fromAgentId: 'a3', fromRole: 'tester', type: 'request', target: 'a1', payload: { summary: 's', content: 'for-a1' } });
    // Targeted at role
    bus.post({ fromAgentId: 'a4', fromRole: 'planner', type: 'plan', target: 'coder', payload: { summary: 's', content: 'for-coder' } });
    // Targeted at different agent — should be skipped
    bus.post({ fromAgentId: 'a5', fromRole: 'reviewer', type: 'feedback', target: 'a2', payload: { summary: 's', content: 'for-a2' } });

    assert.strictEqual(received.length, 3);
  });

  it('getContextForAgent returns formatted markdown', () => {
    const bus = new ContextBus('s1');
    bus.post({ fromAgentId: 'a1', fromRole: 'coder', type: 'contribution', target: '*', payload: { summary: 'My work', content: 'I wrote code', files: ['src/a.ts'] } });
    const ctx = bus.getContextForAgent('a2', 'reviewer');
    assert.ok(ctx.includes('Swarm Context Bus'));
    assert.ok(ctx.includes('My work'));
    assert.ok(ctx.includes('src/a.ts'));
  });

  it('getContextForAgent returns empty for no visible messages', () => {
    const bus = new ContextBus('s1');
    bus.post({ fromAgentId: 'a1', fromRole: 'coder', type: 'contribution', target: 'a3', payload: { summary: 's', content: 'c' } });
    const ctx = bus.getContextForAgent('a2', 'reviewer');
    assert.strictEqual(ctx, '');
  });
});

// -- BusBridgeTool Tests --

describe('BusBridgeTool — swarm_bus tool', () => {
  it('post action adds a message to the bus', async () => {
    const bus = new ContextBus('s1');
    const tool = new BusBridgeTool(bus, 'a1', 'coder');
    const result = await tool.execute({ action: 'post', summary: 'Update', content: 'Did some work', target: '*' });
    assert.ok(result.includes('Message posted'));
    assert.strictEqual(bus.getMessageCount(), 1);
  });

  it('read action returns context', async () => {
    const bus = new ContextBus('s1');
    bus.post({ fromAgentId: 'a2', fromRole: 'reviewer', type: 'feedback', target: '*', payload: { summary: 'Review', content: 'Looks good' } });
    const tool = new BusBridgeTool(bus, 'a1', 'coder');
    const result = await tool.execute({ action: 'read' });
    assert.ok(result.includes('Looks good'));
  });

  it('read action returns no messages text when empty', async () => {
    const bus = new ContextBus('s1');
    const tool = new BusBridgeTool(bus, 'a1', 'coder');
    const result = await tool.execute({ action: 'read' });
    assert.ok(result.includes('No messages'));
  });

  it('vote action posts a vote message', async () => {
    const bus = new ContextBus('s1');
    const tool = new BusBridgeTool(bus, 'a1', 'coder');
    const result = await tool.execute({ action: 'vote', summary: 'My vote', vote: 'approve', reason: 'Good approach' });
    assert.ok(result.includes('Vote'));
    assert.strictEqual(bus.getByType('vote').length, 1);
  });

  it('unknown action returns error message', async () => {
    const bus = new ContextBus('s1');
    const tool = new BusBridgeTool(bus, 'a1', 'coder');
    const result = await tool.execute({ action: 'invalid' });
    assert.ok(result.includes('Unknown action'));
  });

  it('has correct tool metadata', () => {
    const bus = new ContextBus('s1');
    const tool = new BusBridgeTool(bus, 'a1', 'coder');
    assert.strictEqual(tool.name, 'swarm_bus');
    assert.strictEqual(tool.permission, 'auto');
    assert.ok(tool.description.length > 0);
  });
});

// -- Roles Tests --

describe('Swarm Roles — role registry', () => {
  it('ROLE_REGISTRY contains expected roles', () => {
    const roles: AgentRole[] = ['architect', 'coder', 'reviewer', 'tester', 'security_auditor', 'researcher', 'debugger', 'synthesizer', 'planner'];
    for (const role of roles) {
      assert.ok(ROLE_REGISTRY[role], `Missing role: ${role}`);
      assert.ok(ROLE_REGISTRY[role].displayName);
      assert.ok(ROLE_REGISTRY[role].description);
      assert.ok(ROLE_REGISTRY[role].systemPromptSuffix);
    }
  });

  it('getToolsForRole filters correctly for architect (allowedTools set)', () => {
    const allTools = [
      { name: 'read', description: '', parameters: {}, permission: 'auto' as const, execute: async () => '' },
      { name: 'write', description: '', parameters: {}, permission: 'auto' as const, execute: async () => '' },
      { name: 'think', description: '', parameters: {}, permission: 'auto' as const, execute: async () => '' },
    ];
    const tools = getToolsForRole('architect', allTools);
    const names = tools.map(t => t.name);
    assert.ok(names.includes('read'));
    assert.ok(names.includes('think'));
    assert.ok(!names.includes('write'));
  });

  it('getToolsForRole for coder allows all except denied', () => {
    const allTools = [
      { name: 'read', description: '', parameters: {}, permission: 'auto' as const, execute: async () => '' },
      { name: 'browser', description: '', parameters: {}, permission: 'auto' as const, execute: async () => '' },
      { name: 'edit', description: '', parameters: {}, permission: 'auto' as const, execute: async () => '' },
    ];
    const tools = getToolsForRole('coder', allTools);
    const names = tools.map(t => t.name);
    assert.ok(names.includes('read'));
    assert.ok(names.includes('edit'));
    assert.ok(!names.includes('browser'));
  });

  it('getToolsForRole returns filtered tools for empty array', () => {
    const tools = getToolsForRole('coder', []);
    assert.ok(Array.isArray(tools));
    assert.strictEqual(tools.length, 0);
  });

  it('buildRoleSystemPrompt appends role suffix', () => {
    const prompt = buildRoleSystemPrompt('Base prompt', 'architect');
    assert.ok(prompt.startsWith('Base prompt'));
    assert.ok(prompt.includes('AGENT ROLE: Architect'));
  });

  it('buildRoleSystemPrompt returns base for unknown role', () => {
    const prompt = buildRoleSystemPrompt('Base', 'unknown' as AgentRole);
    assert.strictEqual(prompt, 'Base');
  });

  it('each role has a preferredTier', () => {
    for (const [key, config] of Object.entries(ROLE_REGISTRY)) {
      assert.ok(['fast', 'standard', 'powerful'].includes(config.preferredTier), `${key} has invalid tier: ${config.preferredTier}`);
    }
  });
});

// -- Strategy Factory Tests --

describe('Swarm Strategies — createStrategy factory', () => {
  it('creates debate strategy', () => {
    const s = createStrategy('debate');
    assert.strictEqual(s.name, 'debate');
  });

  it('creates moa strategy', () => {
    const s = createStrategy('moa');
    assert.strictEqual(s.name, 'moa');
  });

  it('creates pipeline strategy', () => {
    const s = createStrategy('pipeline');
    assert.strictEqual(s.name, 'pipeline');
  });

  it('creates fan-out strategy', () => {
    const s = createStrategy('fan-out');
    assert.strictEqual(s.name, 'fan-out');
  });

  it('creates generator-critic strategy', () => {
    const s = createStrategy('generator-critic');
    assert.strictEqual(s.name, 'generator-critic');
  });

  it('throws for unknown strategy', () => {
    assert.throws(() => createStrategy('nonexistent'), /Unknown strategy/);
  });

  it('debate strategy accepts config', () => {
    const s = createStrategy('debate', { maxRounds: 5, consensusThreshold: 0.9 });
    assert.strictEqual(s.name, 'debate');
  });

  it('fan-out strategy accepts config', () => {
    const s = createStrategy('fan-out', { maxParallel: 4 });
    assert.strictEqual(s.name, 'fan-out');
  });
});

// -- Pipeline Strategy Execution --

describe('PipelineStrategy — sequential execution', () => {
  it('executes agents in role order', async () => {
    const strategy = new PipelineStrategy();
    const agents = [
      makeStubAgent('a-coder', 'coder', 'code result'),
      makeStubAgent('a-planner', 'planner', 'plan result'),
    ];
    const bus = new ContextBus('s1');

    const events: unknown[] = [];
    for await (const event of strategy.execute(agents, 'build feature', bus, 's1')) {
      events.push(event);
    }

    // Planner should run first (lower pipeline order), then coder
    const completeEvents = (events as Array<{type: string; role: string}>).filter(e => e.type === 'agent_complete');
    assert.strictEqual(completeEvents.length, 2);
    assert.strictEqual(completeEvents[0].role, 'planner');
    assert.strictEqual(completeEvents[1].role, 'coder');
  });

  it('posts contributions to bus during execution', async () => {
    const strategy = new PipelineStrategy();
    const agents = [makeStubAgent('a1', 'coder', 'my output')];
    const bus = new ContextBus('s1');

    for await (const _event of strategy.execute(agents, 'task', bus, 's1')) {
      // consume events
    }

    assert.ok(bus.getMessageCount() > 0);
    const contributions = bus.getByType('contribution');
    assert.ok(contributions.length > 0);
  });
});


// -- DebateStrategy Tests --

describe('DebateStrategy — multi-round debate with consensus', () => {
  it('runs initial proposal round for all agents', async () => {
    const strategy = new DebateStrategy({ maxRounds: 1 });
    const agents = [
      makeStubAgent('d1', 'coder', 'proposal A'),
      makeStubAgent('d2', 'coder', 'proposal B'),
    ];
    const bus = new ContextBus('debate-1');
    const events: SwarmEvent[] = [];
    for await (const ev of strategy.execute(agents, 'build feature', bus, 'debate-1')) {
      events.push(ev);
    }
    const spawns = events.filter(e => e.type === 'agent_spawn');
    assert.strictEqual(spawns.length, 2);
    assert.strictEqual(bus.getByType('contribution').length, 2);
  });

  it('reaches consensus and stops early when agents approve', async () => {
    const strategy = new DebateStrategy({ maxRounds: 5, consensusThreshold: 0.5 });
    const agents = [
      makeStubAgent('d1', 'coder', 'I approve this approach'),
      makeStubAgent('d2', 'coder', 'I approve this approach'),
    ];
    const bus = new ContextBus('debate-2');
    const events: SwarmEvent[] = [];
    for await (const ev of strategy.execute(agents, 'pick approach', bus, 'debate-2')) {
      events.push(ev);
    }
    const voteEvents = events.filter(e => e.type === 'vote');
    assert.ok(voteEvents.length > 0, 'Should emit vote events');
    const consensusVote = voteEvents.find(v => (v.data as any)?.consensus === true);
    assert.ok(consensusVote, 'Should reach consensus');
  });

  it('runs all maxRounds when no consensus is reached', async () => {
    const strategy = new DebateStrategy({ maxRounds: 3, consensusThreshold: 1.0 });
    const agents = [
      makeStubAgent('d1', 'coder', 'I reject this'),
      makeStubAgent('d2', 'coder', 'I also reject'),
    ];
    const bus = new ContextBus('debate-3');
    const events: SwarmEvent[] = [];
    for await (const ev of strategy.execute(agents, 'task', bus, 'debate-3')) {
      events.push(ev);
    }
    const roundStarts = events.filter(e => e.type === 'round_start');
    assert.strictEqual(roundStarts.length, 3);
  });

  it('posts contributions and votes to bus each round', async () => {
    const strategy = new DebateStrategy({ maxRounds: 2, consensusThreshold: 1.0 });
    const agents = [makeStubAgent('d1', 'coder', 'my take')];
    const bus = new ContextBus('debate-4');
    for await (const _ev of strategy.execute(agents, 'task', bus, 'debate-4')) {}
    assert.ok(bus.getByType('contribution').length >= 2);
    assert.ok(bus.getByType('vote').length >= 1);
  });
});

// -- MoAStrategy Tests --

describe('MoAStrategy — proposer/synthesizer pattern', () => {
  it('splits agents into proposers and synthesizer', async () => {
    const strategy = new MoAStrategy();
    const agents = [
      makeStubAgent('m1', 'coder', 'idea 1'),
      makeStubAgent('m2', 'coder', 'idea 2'),
      makeStubAgent('m3', 'synthesizer' as AgentRole, 'merged solution'),
    ];
    const bus = new ContextBus('moa-1');
    const events: SwarmEvent[] = [];
    for await (const ev of strategy.execute(agents, 'solve problem', bus, 'moa-1')) {
      events.push(ev);
    }
    const completeEvents = events.filter(e => e.type === 'agent_complete');
    assert.strictEqual(completeEvents.length, 3);
    const synthEvents = events.filter(e => e.type === 'synthesis');
    assert.strictEqual(synthEvents.length, 1);
  });

  it('returns empty contributions for zero agents', async () => {
    const strategy = new MoAStrategy();
    const bus = new ContextBus('moa-2');
    const result = strategy.execute([], 'task', bus, 'moa-2');
    let returnValue: AgentContribution[] = [];
    while (true) {
      const { value, done } = await result.next();
      if (done) { returnValue = value as AgentContribution[]; break; }
    }
    assert.strictEqual(returnValue.length, 0);
  });

  it('single agent acts as synthesizer only', async () => {
    const strategy = new MoAStrategy();
    const agents = [makeStubAgent('m1', 'coder', 'solo solution')];
    const bus = new ContextBus('moa-3');
    const events: SwarmEvent[] = [];
    for await (const ev of strategy.execute(agents, 'task', bus, 'moa-3')) {
      events.push(ev);
    }
    const completeEvents = events.filter(e => e.type === 'agent_complete');
    assert.strictEqual(completeEvents.length, 1);
  });
});

// -- FanOutGatherStrategy Tests --

describe('FanOutGatherStrategy — parallel subtask execution', () => {
  it('decomposes via planner then fans out to workers', async () => {
    const strategy = new FanOutGatherStrategy({ maxParallel: 4 });
    const agents = [
      makeStubAgent('p1', 'planner', '[{"subtask":"sub1"},{"subtask":"sub2"}]'),
      makeStubAgent('w1', 'coder', 'sub1 done'),
      makeStubAgent('w2', 'coder', 'sub2 done'),
    ];
    const bus = new ContextBus('fan-1');
    const events: SwarmEvent[] = [];
    for await (const ev of strategy.execute(agents, 'big task', bus, 'fan-1')) {
      events.push(ev);
    }
    const completeEvents = events.filter(e => e.type === 'agent_complete');
    assert.strictEqual(completeEvents.length, 3);
  });

  it('handles unparseable planner output gracefully', async () => {
    const strategy = new FanOutGatherStrategy();
    const agents = [
      makeStubAgent('p1', 'planner', 'not valid json'),
      makeStubAgent('w1', 'coder', 'fallback result'),
    ];
    const bus = new ContextBus('fan-2');
    const events: SwarmEvent[] = [];
    for await (const ev of strategy.execute(agents, 'task', bus, 'fan-2')) {
      events.push(ev);
    }
    const completeEvents = events.filter(e => e.type === 'agent_complete');
    assert.ok(completeEvents.length >= 2);
  });

  it('returns empty for zero agents', async () => {
    const strategy = new FanOutGatherStrategy();
    const bus = new ContextBus('fan-3');
    const result = strategy.execute([], 'task', bus, 'fan-3');
    let returnValue: AgentContribution[] = [];
    while (true) {
      const { value, done } = await result.next();
      if (done) { returnValue = value as AgentContribution[]; break; }
    }
    assert.strictEqual(returnValue.length, 0);
  });

  it('uses synthesizer when last agent has synthesizer role', async () => {
    const strategy = new FanOutGatherStrategy();
    const agents = [
      makeStubAgent('w1', 'coder', 'work 1'),
      makeStubAgent('w2', 'coder', 'work 2'),
      makeStubAgent('s1', 'synthesizer' as AgentRole, 'merged'),
    ];
    const bus = new ContextBus('fan-4');
    const events: SwarmEvent[] = [];
    for await (const ev of strategy.execute(agents, 'task', bus, 'fan-4')) {
      events.push(ev);
    }
    const synthEvents = events.filter(e => e.type === 'synthesis');
    assert.strictEqual(synthEvents.length, 1);
  });

  it('respects maxParallel batching', async () => {
    const strategy = new FanOutGatherStrategy({ maxParallel: 1 });
    const agents = [
      makeStubAgent('w1', 'coder', 'r1'),
      makeStubAgent('w2', 'coder', 'r2'),
      makeStubAgent('w3', 'coder', 'r3'),
    ];
    const bus = new ContextBus('fan-5');
    const events: SwarmEvent[] = [];
    for await (const ev of strategy.execute(agents, 'task', bus, 'fan-5')) {
      events.push(ev);
    }
    const completeEvents = events.filter(e => e.type === 'agent_complete');
    assert.strictEqual(completeEvents.length, 3);
  });
});

// -- GeneratorCriticStrategy Tests --

describe('GeneratorCriticStrategy — generate-critique loop', () => {
  it('runs generator then critic', async () => {
    const strategy = new GeneratorCriticStrategy({ maxIterations: 2, qualityThreshold: 10 });
    const agents = [
      makeStubAgent('gen', 'coder', 'initial solution'),
      makeStubAgent('crit', 'reviewer', 'Needs work. Rating: 5/10'),
    ];
    const bus = new ContextBus('gc-1');
    const events: SwarmEvent[] = [];
    for await (const ev of strategy.execute(agents, 'build thing', bus, 'gc-1')) {
      events.push(ev);
    }
    const completeEvents = events.filter(e => e.type === 'agent_complete');
    assert.ok(completeEvents.length >= 2);
    const voteEvents = events.filter(e => e.type === 'vote');
    assert.ok(voteEvents.length > 0);
    assert.strictEqual((voteEvents[0].data as any).score, 5);
  });

  it('stops early when quality threshold is met', async () => {
    const strategy = new GeneratorCriticStrategy({ maxIterations: 5, qualityThreshold: 8 });
    const agents = [
      makeStubAgent('gen', 'coder', 'great solution'),
      makeStubAgent('crit', 'reviewer', 'Excellent! Rating: 9/10'),
    ];
    const bus = new ContextBus('gc-2');
    const events: SwarmEvent[] = [];
    for await (const ev of strategy.execute(agents, 'task', bus, 'gc-2')) {
      events.push(ev);
    }
    const roundStarts = events.filter(e => e.type === 'round_start');
    assert.strictEqual(roundStarts.length, 2);
  });

  it('returns empty contributions for less than 2 agents', async () => {
    const strategy = new GeneratorCriticStrategy();
    const bus = new ContextBus('gc-3');
    const result = strategy.execute([makeStubAgent('solo', 'coder')], 'task', bus, 'gc-3');
    let returnValue: AgentContribution[] = [];
    while (true) {
      const { value, done } = await result.next();
      if (done) { returnValue = value as AgentContribution[]; break; }
    }
    assert.strictEqual(returnValue.length, 0);
  });

  it('handles critic output without rating pattern', async () => {
    const strategy = new GeneratorCriticStrategy({ maxIterations: 2, qualityThreshold: 8 });
    const agents = [
      makeStubAgent('gen', 'coder', 'solution'),
      makeStubAgent('crit', 'reviewer', 'No numerical rating given, just feedback'),
    ];
    const bus = new ContextBus('gc-4');
    const events: SwarmEvent[] = [];
    for await (const ev of strategy.execute(agents, 'task', bus, 'gc-4')) {
      events.push(ev);
    }
    const voteEvents = events.filter(e => e.type === 'vote');
    assert.strictEqual(voteEvents.length, 0);
    const completeEvents = events.filter(e => e.type === 'agent_complete');
    assert.ok(completeEvents.length >= 3);
  });

  it('handles Score: N format', async () => {
    const strategy = new GeneratorCriticStrategy({ maxIterations: 3, qualityThreshold: 7 });
    const agents = [
      makeStubAgent('gen', 'coder', 'solution'),
      makeStubAgent('crit', 'reviewer', 'Good. Score: 8'),
    ];
    const bus = new ContextBus('gc-5');
    const events: SwarmEvent[] = [];
    for await (const ev of strategy.execute(agents, 'task', bus, 'gc-5')) {
      events.push(ev);
    }
    const voteEvents = events.filter(e => e.type === 'vote');
    assert.ok(voteEvents.length > 0);
    assert.strictEqual((voteEvents[0].data as any).score, 8);
  });
});

// -- SwarmRouter Tests --

describe('SwarmRouter — task analysis and strategy selection', () => {
  function makeProviders(): ProviderSlot[] {
    return [
      { providerName: 'anthropic', model: 'claude-sonnet', provider: {} as any, tier: 'powerful', costPerMToken: 3 },
      { providerName: 'openai', model: 'gpt-4', provider: {} as any, tier: 'powerful', costPerMToken: 10 },
      { providerName: 'groq', model: 'llama3-8b', provider: {} as any, tier: 'fast', costPerMToken: 0.1 },
      { providerName: 'deepseek', model: 'deepseek-coder', provider: {} as any, tier: 'standard', costPerMToken: 1 },
    ];
  }

  it('uses preferred strategy when specified and not auto', () => {
    const router = new SwarmRouter(makeProviders(), new SwarmScorer());
    const decision = router.route('simple task', { preferredStrategy: 'debate' });
    assert.strictEqual(decision.strategy, 'debate');
  });

  it('auto-selects debate for decision-making tasks', () => {
    const router = new SwarmRouter(makeProviders(), new SwarmScorer());
    const decision = router.route('design the best approach for our new architecture, compare alternatives and evaluate trade-offs');
    assert.strictEqual(decision.strategy, 'debate');
  });

  it('selects fan-out for batch/parallel tasks', () => {
    const router = new SwarmRouter(makeProviders(), new SwarmScorer());
    const decision = router.route('refactor all components across multiple files, batch update every module');
    assert.strictEqual(decision.strategy, 'fan-out');
  });

  it('selects pipeline for sequential tasks', () => {
    const router = new SwarmRouter(makeProviders(), new SwarmScorer());
    const decision = router.route('first plan the feature, then implement it, then test and review it');
    assert.strictEqual(decision.strategy, 'pipeline');
  });

  it('selects generator-critic for quality-focused tasks', () => {
    const router = new SwarmRouter(makeProviders(), new SwarmScorer());
    const decision = router.route('optimize and refine this code for high quality security audit compliance');
    assert.strictEqual(decision.strategy, 'generator-critic');
  });

  it('defaults to pipeline for simple tasks', () => {
    const router = new SwarmRouter(makeProviders(), new SwarmScorer());
    const decision = router.route('fix bug');
    assert.strictEqual(decision.strategy, 'pipeline');
  });

  it('produces role assignments', () => {
    const router = new SwarmRouter(makeProviders(), new SwarmScorer());
    const decision = router.route('build feature', { preferredStrategy: 'pipeline' });
    assert.ok(decision.assignments.length > 0);
    const roles = decision.assignments.map(a => a.role);
    assert.ok(roles.includes('planner'));
    assert.ok(roles.includes('coder'));
  });

  it('includes rationale', () => {
    const router = new SwarmRouter(makeProviders(), new SwarmScorer());
    const decision = router.route('compare approaches');
    assert.ok(decision.rationale.length > 0);
  });

  it('estimates cost as non-negative', () => {
    const router = new SwarmRouter(makeProviders(), new SwarmScorer());
    const decision = router.route('task', { preferredStrategy: 'moa' });
    assert.ok(decision.estimatedCost >= 0);
  });

  it('falls back when no provider matches requested tier', () => {
    const providers: ProviderSlot[] = [
      { providerName: 'groq', model: 'llama3-8b', provider: {} as any, tier: 'fast', costPerMToken: 0.1 },
    ];
    const router = new SwarmRouter(providers, new SwarmScorer());
    const decision = router.route('task', { preferredStrategy: 'pipeline' });
    assert.ok(decision.assignments.length > 0);
  });
});

// -- SwarmScorer Tests --

describe('SwarmScorer — agent scoring and performance tracking', () => {
  it('scores an agent contribution with all factors', () => {
    const scorer = new SwarmScorer();
    const score = scorer.scoreAgent('a1', 'test-model', 'coder', {
      content: 'A'.repeat(500), toolCalls: ['read_file', 'write_file'],
      filesModified: ['src/a.ts'], durationMs: 2000,
      tokenUsage: { input: 100, output: 200 }, errors: 0,
    });
    assert.ok(score.qualityScore > 0);
    assert.ok(score.qualityScore <= 10);
    assert.ok(score.factors.length >= 4);
  });

  it('coder role gets file_impact factor', () => {
    const scorer = new SwarmScorer();
    const score = scorer.scoreAgent('a1', 'model', 'coder', {
      content: 'code', toolCalls: [], filesModified: ['a.ts', 'b.ts'], durationMs: 1000,
      tokenUsage: { input: 50, output: 50 }, errors: 0,
    });
    const fileImpact = score.factors.find(f => f.name === 'file_impact');
    assert.ok(fileImpact);
  });

  it('non-coding role does not get file_impact factor', () => {
    const scorer = new SwarmScorer();
    const score = scorer.scoreAgent('a1', 'model', 'researcher', {
      content: 'findings', toolCalls: ['web_fetch'], filesModified: [], durationMs: 1000,
      tokenUsage: { input: 50, output: 100 }, errors: 0,
    });
    const fileImpact = score.factors.find(f => f.name === 'file_impact');
    assert.strictEqual(fileImpact, undefined);
  });

  it('reliability degrades with errors', () => {
    const scorer = new SwarmScorer();
    const noErrors = scorer.scoreAgent('a1', 'model', 'coder', {
      content: 'code', toolCalls: [], filesModified: [], durationMs: 1000,
      tokenUsage: { input: 50, output: 50 }, errors: 0,
    });
    const manyErrors = scorer.scoreAgent('a2', 'model2', 'coder', {
      content: 'code', toolCalls: [], filesModified: [], durationMs: 1000,
      tokenUsage: { input: 50, output: 50 }, errors: 5,
    });
    assert.ok(noErrors.qualityScore > manyErrors.qualityScore);
  });

  it('records and retrieves model performance', () => {
    const scorer = new SwarmScorer();
    scorer.scoreAgent('a1', 'claude-test', 'coder', {
      content: 'output', toolCalls: [], filesModified: [], durationMs: 1000,
      tokenUsage: { input: 50, output: 100 }, errors: 0,
    });
    const perf = scorer.getModelPerformance('claude-test', 'coder');
    assert.ok(perf);
    assert.strictEqual(perf!.totalRuns, 1);
  });

  it('updates running averages', () => {
    const scorer = new SwarmScorer();
    scorer.scoreAgent('a1', 'multi-test', 'reviewer', {
      content: 'review 1', toolCalls: ['read_file'], filesModified: [], durationMs: 500,
      tokenUsage: { input: 100, output: 200 }, errors: 0,
    });
    scorer.scoreAgent('a2', 'multi-test', 'reviewer', {
      content: 'review 2 longer output', toolCalls: ['read_file', 'think'], filesModified: [], durationMs: 1500,
      tokenUsage: { input: 100, output: 200 }, errors: 0,
    });
    const perf = scorer.getModelPerformance('multi-test', 'reviewer');
    assert.ok(perf);
    assert.strictEqual(perf!.totalRuns, 2);
    assert.ok(perf!.avgDurationMs > 500 && perf!.avgDurationMs < 1500);
  });

  it('getBestModelForRole requires minimum 3 runs', () => {
    const scorer = new SwarmScorer();
    scorer.scoreAgent('a1', 'model-x', 'coder', {
      content: 'good output', toolCalls: ['read_file'], filesModified: ['a.ts'], durationMs: 500,
      tokenUsage: { input: 100, output: 200 }, errors: 0,
    });
    assert.strictEqual(scorer.getBestModelForRole('coder'), null);
  });

  it('getBestModelForRole returns top scorer with 3+ runs', () => {
    const scorer = new SwarmScorer();
    for (let i = 0; i < 3; i++) {
      scorer.scoreAgent('a1', 'good-model', 'coder', {
        content: 'A'.repeat(500), toolCalls: ['read_file', 'write_file'], filesModified: ['a.ts'],
        durationMs: 500, tokenUsage: { input: 100, output: 200 }, errors: 0,
      });
    }
    for (let i = 0; i < 3; i++) {
      scorer.scoreAgent('a2', 'bad-model', 'coder', {
        content: 'x', toolCalls: [], filesModified: [], durationMs: 5000,
        tokenUsage: { input: 10, output: 5 }, errors: 3,
      });
    }
    assert.strictEqual(scorer.getBestModelForRole('coder'), 'good-model');
  });

  it('weight normalization ensures factors sum to ~1', () => {
    const scorer = new SwarmScorer();
    const score = scorer.scoreAgent('a1', 'model', 'coder', {
      content: 'output', toolCalls: ['read'], filesModified: ['f.ts'], durationMs: 1000,
      tokenUsage: { input: 50, output: 100 }, errors: 0,
    });
    const totalWeight = score.factors.reduce((sum, f) => sum + f.weight, 0);
    assert.ok(Math.abs(totalWeight - 1.0) < 0.01);
  });
});

// -- Strategy edge cases --

describe('Strategy edge cases — error handling', () => {
  function makeFailingAgent(id: string, role: AgentRole): SwarmAgent {
    return {
      id, role, model: 'fail-model', providerName: 'test', status: 'idle' as const, depth: 0,
      async run(_prompt: string): Promise<AgentRunResult> {
        return { output: 'error occurred', toolCalls: [], filesModified: [], durationMs: 10, tokenUsage: { input: 5, output: 5 }, errors: 3 };
      },
    };
  }

  it('Pipeline handles agent with errors gracefully', async () => {
    const strategy = new PipelineStrategy();
    const agents = [makeFailingAgent('f1', 'planner'), makeStubAgent('a1', 'coder', 'recovery')];
    const bus = new ContextBus('edge-1');
    const events: SwarmEvent[] = [];
    for await (const ev of strategy.execute(agents, 'task', bus, 'edge-1')) {
      events.push(ev);
    }
    assert.strictEqual(events.filter(e => e.type === 'agent_complete').length, 2);
  });

  it('Pipeline sorts unknown roles after known ones', async () => {
    const strategy = new PipelineStrategy();
    const agents = [makeStubAgent('a1', 'debugger', 'debug'), makeStubAgent('a2', 'planner', 'plan')];
    const bus = new ContextBus('edge-2');
    const events: SwarmEvent[] = [];
    for await (const ev of strategy.execute(agents, 'task', bus, 'edge-2')) {
      events.push(ev);
    }
    const completes = events.filter(e => e.type === 'agent_complete');
    assert.strictEqual(completes[0].role, 'planner');
    assert.strictEqual(completes[1].role, 'debugger');
  });

  it('Debate returns contributions even with single agent', async () => {
    const strategy = new DebateStrategy({ maxRounds: 2 });
    const agents = [makeStubAgent('solo', 'coder', 'only opinion')];
    const bus = new ContextBus('edge-3');
    const result = strategy.execute(agents, 'task', bus, 'edge-3');
    let returnValue: AgentContribution[] = [];
    while (true) {
      const { value, done } = await result.next();
      if (done) { returnValue = value as AgentContribution[]; break; }
    }
    assert.ok(returnValue.length > 0);
  });
});
