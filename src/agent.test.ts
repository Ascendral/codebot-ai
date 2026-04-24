import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Agent } from './agent';
import { LLMProvider, Message, ToolSchema, StreamEvent } from './types';
import { UserProfile } from './user-profile';

const originalCodebotHome = process.env.CODEBOT_HOME;

before(() => {
  process.env.CODEBOT_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'codebot-agent-home-'));
});

after(() => {
  if (originalCodebotHome === undefined) delete process.env.CODEBOT_HOME;
  else process.env.CODEBOT_HOME = originalCodebotHome;
});

/**
 * Mock LLM provider that returns scripted responses.
 */
class MockProvider implements LLMProvider {
  name = 'mock';
  private responses: Array<{ text?: string; toolCalls?: Array<{ name: string; args: Record<string, unknown> }> }>;
  private callIndex = 0;

  constructor(responses: Array<{ text?: string; toolCalls?: Array<{ name: string; args: Record<string, unknown> }> }>) {
    this.responses = responses;
  }

  async *chat(_messages: Message[], _tools?: ToolSchema[]): AsyncGenerator<StreamEvent> {
    const response = this.responses[this.callIndex++] || { text: 'No more responses.' };

    if (response.text) {
      yield { type: 'text', text: response.text };
    }

    if (response.toolCalls) {
      for (let i = 0; i < response.toolCalls.length; i++) {
        const tc = response.toolCalls[i];
        yield {
          type: 'tool_call_end',
          toolCall: {
            id: `call_${i}`,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args),
            },
          },
        };
      }
    }

    yield { type: 'done' };
  }
}

describe('Agent', () => {
  it('produces text events from LLM response', async () => {
    const provider = new MockProvider([{ text: 'Hello, world!' }]);
    const agent = new Agent({
      provider,
      model: 'mock-model',
      autoApprove: true,
    });

    const events = [];
    for await (const event of agent.run('Hi')) {
      events.push(event);
    }

    const textEvents = events.filter((e) => e.type === 'text');
    assert.ok(textEvents.length > 0, 'Should have text events');
    assert.strictEqual(textEvents[0].text, 'Hello, world!');
    assert.ok(
      events.some((e) => e.type === 'done'),
      'Should end with done',
    );
  });

  it('executes tool calls and feeds results back', async () => {
    const provider = new MockProvider([
      {
        text: 'Let me think about this.',
        toolCalls: [{ name: 'think', args: { thought: 'Planning my approach' } }],
      },
      { text: 'Done thinking.' },
    ]);

    const agent = new Agent({
      provider,
      model: 'mock-model',
      autoApprove: true,
    });

    const events = [];
    for await (const event of agent.run('Think about something')) {
      events.push(event);
    }

    assert.ok(
      events.some((e) => e.type === 'tool_call'),
      'Should have tool_call event',
    );
    assert.ok(
      events.some((e) => e.type === 'tool_result'),
      'Should have tool_result event',
    );
    assert.ok(
      events.some((e) => e.type === 'done'),
      'Should end with done',
    );
  });

  it('handles unknown tool names gracefully', async () => {
    const provider = new MockProvider([
      {
        toolCalls: [{ name: 'nonexistent_tool', args: {} }],
      },
      { text: 'Tool not found, sorry.' },
    ]);

    const agent = new Agent({
      provider,
      model: 'mock-model',
      autoApprove: true,
    });

    const events = [];
    for await (const event of agent.run('Use fake tool')) {
      events.push(event);
    }

    const errorResult = events.find((e) => e.type === 'tool_result' && e.toolResult?.is_error);
    assert.ok(errorResult, 'Should have error result for unknown tool');
    assert.ok(errorResult?.toolResult?.result?.includes('Unknown tool'), 'Error should mention unknown tool');
  });

  it('respects max iterations', async () => {
    // Provider always returns tool calls, never plain text
    const infiniteToolProvider = new MockProvider(
      Array(10).fill({
        toolCalls: [{ name: 'think', args: { thought: 'loop' } }],
      }),
    );

    const agent = new Agent({
      provider: infiniteToolProvider,
      model: 'mock-model',
      maxIterations: 3,
      autoApprove: true,
    });

    const events = [];
    for await (const event of agent.run('Loop forever')) {
      events.push(event);
    }

    const errorEvent = events.find((e) => e.type === 'error');
    assert.ok(errorEvent, 'Should hit max iterations error');
    assert.ok(errorEvent?.error?.includes('Max iterations'), 'Error should mention max iterations');
  });

  it('clears history correctly', async () => {
    const provider = new MockProvider([{ text: 'Response 1' }, { text: 'Response 2' }]);
    const agent = new Agent({
      provider,
      model: 'mock-model',
      autoApprove: true,
    });

    // Run one message
    for await (const event of agent.run('First message')) {
      void event;
    }
    const before = agent.getMessages().length;
    assert.ok(before > 1, 'Should have messages after first run');

    // Clear
    agent.clearHistory();
    const after = agent.getMessages().length;
    assert.strictEqual(after, 1, 'Should only have system message after clear');
  });

  it('uses projectRoot when provided', async () => {
    const provider = new MockProvider([{ text: 'OK' }]);
    const customRoot = '/tmp/custom-project';
    const agent = new Agent({
      provider,
      model: 'mock-model',
      autoApprove: true,
      projectRoot: customRoot,
    });

    // Agent should accept projectRoot without error
    const events = [];
    for await (const event of agent.run('Hello')) {
      events.push(event);
    }
    assert.ok(
      events.some((e) => e.type === 'done'),
      'Should complete with custom projectRoot',
    );
  });

  it('falls back to cwd when projectRoot not provided', async () => {
    const provider = new MockProvider([{ text: 'OK' }]);
    const agent = new Agent({
      provider,
      model: 'mock-model',
      autoApprove: true,
      // no projectRoot specified
    });

    const events = [];
    for await (const event of agent.run('Hello')) {
      events.push(event);
    }
    assert.ok(
      events.some((e) => e.type === 'done'),
      'Should complete without projectRoot',
    );
  });

  it('propagates projectRoot through tool execution', async () => {
    const provider = new MockProvider([
      {
        toolCalls: [{ name: 'think', args: { thought: 'test' } }],
      },
      { text: 'Done.' },
    ]);

    const customRoot = '/tmp/test-project';
    const agent = new Agent({
      provider,
      model: 'mock-model',
      autoApprove: true,
      projectRoot: customRoot,
    });

    const events = [];
    for await (const event of agent.run('Test projectRoot')) {
      events.push(event);
    }

    // Tool execution should succeed (think tool doesn't depend on filesystem)
    const toolResult = events.find((e) => e.type === 'tool_result');
    assert.ok(toolResult, 'Should have tool result with custom projectRoot');
  });

  it('refreshes the system prompt with durable task state before each run', async () => {
    let capturedMessages: Message[] = [];

    class InspectingProvider implements LLMProvider {
      name = 'inspecting-mock';

      async *chat(messages: Message[], _tools?: ToolSchema[]): AsyncGenerator<StreamEvent> {
        capturedMessages = messages;
        yield { type: 'text', text: 'Done.' };
        yield { type: 'done' };
      }
    }

    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codebot-agent-project-'));
    const agent = new Agent({
      provider: new InspectingProvider(),
      model: 'mock-model',
      autoApprove: true,
      projectRoot,
    });

    for await (const event of agent.run('Fix the dashboard port mismatch')) {
      void event;
    }

    const systemMessage = capturedMessages[0];
    assert.ok(systemMessage.content.includes('## Durable Task State'));
    assert.ok(systemMessage.content.includes('Active task: Fix the dashboard port mismatch'));
  });

  it('persists learned user preferences after a run completes', async () => {
    class QuietProvider implements LLMProvider {
      name = 'quiet-mock';

      async *chat(_messages: Message[], _tools?: ToolSchema[]): AsyncGenerator<StreamEvent> {
        yield { type: 'text', text: 'I will keep it brief.' };
        yield { type: 'done' };
      }
    }

    const agent = new Agent({
      provider: new QuietProvider(),
      model: 'mock-model',
      autoApprove: true,
    });

    for await (const event of agent.run('Please keep it short and concise.')) {
      void event;
    }

    const profile = new UserProfile();
    assert.strictEqual(profile.getData().preferences.verbosity, 'concise');
  });
});

// ── 2026-04-23 sweep: graphics tool fs_write capability gating ──────────
//
// Before this fix, `checkToolCapabilities` only gated fs_write on
// `write_file` / `edit_file` / `batch_edit`. The graphics tool writes to
// an agent-controlled `output` path (svg / og_image / favicon / resize /
// convert / compress / crop / watermark / combine) — none of which ran
// through `policyEnforcer.checkCapability(..., 'fs_write', ...)`. A
// graphics call with `output="../.ssh/authorized_keys"` would slip
// straight past the write-side policy.
//
// These tests seed a `.codebot/policy.json` restricting graphics writes
// to `./assets/**`, then exercise `agent.evaluateToolCall('graphics', …)`
// with both allowed and disallowed output paths. evaluateToolCall is the
// single source of truth the real tool-dispatch path and the dashboard
// /tool/run endpoint both call into, so a pass here proves the gate
// covers every entry point.
describe('Agent.evaluateToolCall — graphics fs_write gating (2026-04-23)', () => {
  function setupAgent(): { agent: Agent; projectRoot: string } {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codebot-graphics-cap-'));
    fs.mkdirSync(path.join(projectRoot, '.codebot'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, '.codebot', 'policy.json'),
      JSON.stringify({
        tools: {
          capabilities: {
            graphics: { fs_write: ['./assets/**'] },
          },
        },
      }),
    );
    // Pre-create the allowed dir and a sibling image so input-derived paths work
    fs.mkdirSync(path.join(projectRoot, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'assets', 'source.png'), 'fake-png');

    const agent = new Agent({
      provider: new MockProvider([]),
      model: 'mock-model',
      autoApprove: true,
      projectRoot,
    });
    return { agent, projectRoot };
  }

  it('allows graphics.svg when output is inside allowed glob', () => {
    const { agent, projectRoot } = setupAgent();
    const verdict = agent.evaluateToolCall('graphics', {
      action: 'svg',
      svg_type: 'icon',
      output: path.join(projectRoot, 'assets', 'icon.svg'),
      text: 'CB',
    });
    assert.strictEqual(verdict.allowed, true, `expected allowed, got: ${verdict.reason}`);
  });

  it('blocks graphics.svg when output escapes to a sensitive path', () => {
    const { agent, projectRoot } = setupAgent();
    const verdict = agent.evaluateToolCall('graphics', {
      action: 'svg',
      svg_type: 'icon',
      output: path.join(projectRoot, '.env'),
      text: 'CB',
    });
    assert.strictEqual(verdict.allowed, false);
    assert.strictEqual(verdict.category, 'capability_block');
    assert.match(verdict.reason || '', /fs_write/);
  });

  it('blocks graphics.og_image when output lands outside allowed glob', () => {
    const { agent, projectRoot } = setupAgent();
    const verdict = agent.evaluateToolCall('graphics', {
      action: 'og_image',
      title: 'Hi',
      output: path.join(projectRoot, 'public', 'og.svg'),
    });
    assert.strictEqual(verdict.allowed, false);
    assert.strictEqual(verdict.category, 'capability_block');
  });

  it('blocks graphics.favicon when output directory is outside allowed glob', () => {
    const { agent, projectRoot } = setupAgent();
    const verdict = agent.evaluateToolCall('graphics', {
      action: 'favicon',
      input: path.join(projectRoot, 'assets', 'source.png'),
      output: path.join(projectRoot, 'dist'), // dist/ not in ./assets/**
      sizes: '16,32',
    });
    assert.strictEqual(verdict.allowed, false);
    assert.strictEqual(verdict.category, 'capability_block');
  });

  it('blocks graphics.resize when auto-derived output (from input) is outside allowed glob', () => {
    // resize with no `output` writes to a sibling of `input`. The sibling
    // path must still be checked — this is exactly the "omit output to
    // bypass the gate" attack vector the fix closes.
    const { agent, projectRoot } = setupAgent();
    // Drop a source image OUTSIDE the allowed ./assets/** glob
    const outsideDir = path.join(projectRoot, 'downloads');
    fs.mkdirSync(outsideDir, { recursive: true });
    const outsideInput = path.join(outsideDir, 'pic.png');
    fs.writeFileSync(outsideInput, 'fake-png');

    const verdict = agent.evaluateToolCall('graphics', {
      action: 'resize',
      input: outsideInput, // no output → sibling write lands in downloads/
      width: 64,
      height: 64,
    });
    assert.strictEqual(verdict.allowed, false);
    assert.strictEqual(verdict.category, 'capability_block');
  });

  it('does not gate graphics.info (read-only action)', () => {
    const { agent, projectRoot } = setupAgent();
    const verdict = agent.evaluateToolCall('graphics', {
      action: 'info',
      input: path.join(projectRoot, 'assets', 'source.png'),
    });
    // No output path → no fs_write check at all
    assert.strictEqual(verdict.allowed, true, `expected allowed for info, got: ${verdict.reason}`);
  });
});
