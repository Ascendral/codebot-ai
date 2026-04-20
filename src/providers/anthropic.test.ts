/**
 * Regression test for the "Invalid JSON arguments for <tool>" failure mode.
 *
 * Scenario: Anthropic's SSE stream gets truncated mid-tool_use (the server
 * hangs up, our CHUNK_TIMEOUT fires, or the model hits max_tokens while
 * emitting input_json_delta). Before this guard, the provider flushed whatever
 * partial_json chunks it had accumulated into a tool_call_end, and the agent
 * loop surfaced the resulting JSON.parse failure as
 *   "Error: Invalid JSON arguments for write_file"
 * which is misleading — the real cause is a truncated stream.
 *
 * The fix validates block.input with JSON.parse before emitting; on failure it
 * emits a `type:'error'` event with a clear message instead of a broken
 * tool_call_end. These tests pin that behavior.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { AnthropicProvider } from './anthropic';
import type { StreamEvent } from '../types';

/**
 * Build a mock fetch that returns a streaming Response whose body yields the
 * given SSE lines. Each entry becomes one Uint8Array chunk, so chunk
 * boundaries are deterministic.
 */
function mockFetchWithSSE(sseLines: string[]): typeof fetch {
  return (async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of sseLines) {
          controller.enqueue(encoder.encode(line));
        }
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }) as unknown as typeof fetch;
}

async function collect(provider: AnthropicProvider): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const ev of provider.chat([{ role: 'user', content: 'ignored' }])) {
    events.push(ev);
  }
  return events;
}

describe('AnthropicProvider truncated-tool_use guard', () => {
  it('truncated input_json_delta at message_delta → emits error, NOT tool_call_end', async () => {
    const originalFetch = globalThis.fetch;
    // SSE sequence: tool_use block opens, two input_json_delta chunks build an
    // INCOMPLETE JSON object ('{"content":"hello' — no closing quote or brace),
    // then message_delta tells us the message is done. With the guard, this
    // must yield an `error` event, not a malformed tool_call_end.
    const sse = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"write_file","input":{}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"content\\":\\"hel"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"lo"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":5}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];
    globalThis.fetch = mockFetchWithSSE(sse);
    try {
      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-3-5-sonnet-20241022',
      });
      const events = await collect(provider);

      const toolCallEnds = events.filter(e => e.type === 'tool_call_end');
      const errors = events.filter(e => e.type === 'error');

      assert.strictEqual(
        toolCallEnds.length,
        0,
        `Expected no tool_call_end for a truncated stream; got ${toolCallEnds.length}. ` +
          `Events: ${JSON.stringify(events.map(e => e.type))}`,
      );
      assert.ok(errors.length >= 1, `Expected an error event; got ${errors.length}`);
      const errMsg = (errors[0] as { type: 'error'; error: string }).error;
      assert.match(errMsg, /incomplete tool_use/, `Error message: ${errMsg}`);
      assert.match(errMsg, /write_file/, `Error should name the tool: ${errMsg}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('complete input_json_delta at message_delta → emits tool_call_end with valid JSON', async () => {
    const originalFetch = globalThis.fetch;
    // Control case: the same stream but COMPLETE. Must produce one
    // tool_call_end with parseable arguments and zero errors.
    const sse = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"write_file","input":{}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"content\\":\\"hel"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"lo\\"}"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":10}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];
    globalThis.fetch = mockFetchWithSSE(sse);
    try {
      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-3-5-sonnet-20241022',
      });
      const events = await collect(provider);

      const toolCallEnds = events.filter(e => e.type === 'tool_call_end');
      const errors = events.filter(e => e.type === 'error');

      assert.strictEqual(errors.length, 0, `Expected no errors; got ${JSON.stringify(errors)}`);
      assert.strictEqual(toolCallEnds.length, 1, 'Expected exactly one tool_call_end');
      const tc = (toolCallEnds[0] as { type: 'tool_call_end'; toolCall: { function: { name: string; arguments: string } } }).toolCall;
      assert.strictEqual(tc.function.name, 'write_file');
      const parsed = JSON.parse(tc.function.arguments);
      assert.strictEqual(parsed.content, 'hello');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('stream ends before message_delta (fallback flush) with incomplete JSON → emits error', async () => {
    const originalFetch = globalThis.fetch;
    // Stream is cut off entirely — no message_delta, no message_stop.
    // The fallback flush path at the end of chat() hits this case.
    const sse = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"write_file","input":{}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"content\\":\\"hel"}}\n\n',
      // ...stream ends here
    ];
    globalThis.fetch = mockFetchWithSSE(sse);
    try {
      const provider = new AnthropicProvider({
        apiKey: 'test-key',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-3-5-sonnet-20241022',
      });
      const events = await collect(provider);

      const toolCallEnds = events.filter(e => e.type === 'tool_call_end');
      const errors = events.filter(e => e.type === 'error');

      assert.strictEqual(
        toolCallEnds.length,
        0,
        `Expected no tool_call_end on aborted stream; got ${toolCallEnds.length}`,
      );
      assert.ok(errors.length >= 1, 'Expected an error event on aborted stream');
      const msgs = errors.map(e => (e as { type: 'error'; error: string }).error).join(' | ');
      assert.match(msgs, /incomplete tool_use/, `Error chain: ${msgs}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
