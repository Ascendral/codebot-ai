import { describe, it, before } from 'node:test';
import * as assert from 'node:assert';
import { ThinkTool } from './think';

describe('ThinkTool', () => {
  let tool: ThinkTool;

  before(() => {
    tool = new ThinkTool();
  });

  it('should have correct tool metadata', () => {
    assert.strictEqual(tool.name, 'think');
    assert.strictEqual(tool.permission, 'auto');
  });

  it('should have thought as a required parameter', () => {
    const params = tool.parameters as { required: string[] };
    assert.ok(params.required.includes('thought'));
  });

  it('should return "Thought recorded." for any input', async () => {
    const result = await tool.execute({ thought: 'I need to analyze this code' });
    assert.strictEqual(result, 'Thought recorded.');
  });

  it('should return "Thought recorded." even with empty thought', async () => {
    const result = await tool.execute({ thought: '' });
    assert.strictEqual(result, 'Thought recorded.');
  });

  it('should return "Thought recorded." with no args', async () => {
    const result = await tool.execute({});
    assert.strictEqual(result, 'Thought recorded.');
  });

  it('should return "Thought recorded." with a very long thought', async () => {
    const longThought = 'x'.repeat(10000);
    const result = await tool.execute({ thought: longThought });
    assert.strictEqual(result, 'Thought recorded.');
  });

  it('should return "Thought recorded." with special characters', async () => {
    const result = await tool.execute({ thought: 'Analysis: <script>alert("xss")</script> & more' });
    assert.strictEqual(result, 'Thought recorded.');
  });

  it('should have no side effects (pure function)', async () => {
    // Execute multiple times - should always return same result
    const results = await Promise.all([
      tool.execute({ thought: 'first' }),
      tool.execute({ thought: 'second' }),
      tool.execute({ thought: 'third' }),
    ]);
    assert.deepStrictEqual(results, ['Thought recorded.', 'Thought recorded.', 'Thought recorded.']);
  });

  it('should have a description mentioning reasoning/scratchpad', () => {
    assert.ok(tool.description.includes('reasoning') || tool.description.includes('scratchpad'));
  });
});
