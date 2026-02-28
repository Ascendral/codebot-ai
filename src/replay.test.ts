import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { ReplayProvider, compareOutputs, loadSessionForReplay } from './replay';
import { Message } from './types';

describe('ReplayProvider', () => {
  it('yields recorded text content', async () => {
    const assistantMsgs: Message[] = [
      { role: 'assistant', content: 'Hello from replay' },
    ];
    const provider = new ReplayProvider(assistantMsgs);
    const events = [];
    for await (const event of provider.chat([])) {
      events.push(event);
    }
    assert.ok(events.some(e => e.type === 'text' && e.text === 'Hello from replay'));
    assert.ok(events.some(e => e.type === 'done'));
  });

  it('yields recorded tool calls', async () => {
    const assistantMsgs: Message[] = [
      {
        role: 'assistant',
        content: 'Let me check',
        tool_calls: [{
          id: 'tc_1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"test.ts"}' },
        }],
      },
    ];
    const provider = new ReplayProvider(assistantMsgs);
    const events = [];
    for await (const event of provider.chat([])) {
      events.push(event);
    }
    assert.ok(events.some(e => e.type === 'tool_call_end'));
    assert.ok(events.some(e => e.type === 'text' && e.text === 'Let me check'));
  });

  it('handles exhausted responses gracefully', async () => {
    const provider = new ReplayProvider([]); // No messages to replay
    const events = [];
    for await (const event of provider.chat([])) {
      events.push(event);
    }
    assert.ok(events.some(e => e.type === 'text' && e.text?.includes('no more recorded')));
    assert.ok(events.some(e => e.type === 'done'));
  });

  it('advances through multiple calls', async () => {
    const msgs: Message[] = [
      { role: 'assistant', content: 'First response' },
      { role: 'assistant', content: 'Second response' },
    ];
    const provider = new ReplayProvider(msgs);

    // First call
    const events1 = [];
    for await (const e of provider.chat([])) events1.push(e);
    assert.ok(events1.some(e => e.text === 'First response'));

    // Second call
    const events2 = [];
    for await (const e of provider.chat([])) events2.push(e);
    assert.ok(events2.some(e => e.text === 'Second response'));
  });
});

describe('compareOutputs', () => {
  it('returns null for identical outputs', () => {
    assert.strictEqual(compareOutputs('hello world', 'hello world'), null);
  });

  it('returns null for whitespace-only differences', () => {
    assert.strictEqual(compareOutputs('  hello  world  ', 'hello world'), null);
    assert.strictEqual(compareOutputs('hello\n  world', 'hello world'), null);
  });

  it('returns diff for content differences', () => {
    const result = compareOutputs('expected output', 'actual output');
    assert.ok(result !== null);
    assert.ok(result.includes('Expected:'));
    assert.ok(result.includes('Actual:'));
  });

  it('truncates long outputs in diff', () => {
    const long = 'x'.repeat(500);
    const result = compareOutputs(long, 'short');
    assert.ok(result !== null);
    assert.ok(result.includes('...'));
  });
});

describe('loadSessionForReplay', () => {
  it('returns null for nonexistent session', () => {
    const result = loadSessionForReplay('nonexistent-session-id-xyz');
    assert.strictEqual(result, null);
  });
});
