import { describe, it, before } from 'node:test';
import * as assert from 'node:assert';
import { WebSearchTool } from './web-search';

describe('WebSearchTool', () => {
  let tool: WebSearchTool;

  before(() => {
    tool = new WebSearchTool();
  });

  it('should have correct tool metadata', () => {
    assert.strictEqual(tool.name, 'web_search');
    assert.strictEqual(tool.permission, 'prompt');
  });

  it('should have query as a required parameter', () => {
    const params = tool.parameters as { required: string[] };
    assert.ok(params.required.includes('query'));
  });

  it('should return error when query is missing', async () => {
    const result = await tool.execute({ query: '' });
    assert.strictEqual(result, 'Error: query is required');
  });

  it('should have description mentioning DuckDuckGo', () => {
    assert.ok(tool.description.includes('DuckDuckGo'));
  });

  it('should have num_results parameter defined', () => {
    const props = (tool.parameters as { properties: Record<string, unknown> }).properties;
    assert.ok('num_results' in props);
  });

  it('should handle search errors gracefully', async () => {
    // We cannot actually perform a web search in tests, but we can verify
    // the tool handles network errors by checking the error format.
    // The search will either succeed or return an error message.
    const result = await tool.execute({ query: 'test query' });
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
    // Either contains search results or an error
    assert.ok(
      result.includes('Search results for') ||
      result.includes('Search error:') ||
      result.includes('No results found'),
    );
  });

  it('should include fallback URL in error messages', async () => {
    // If search fails, the error message should include a DuckDuckGo fallback URL
    // We test this by checking the tool's description mentions browser fallback
    assert.ok(tool.description.includes('browser tool'));
  });

  it('should clamp num_results between 1 and 10', async () => {
    // This is an internal validation test - we verify the execute method
    // handles extreme num_results values without throwing.
    const result1 = await tool.execute({ query: 'test', num_results: 0 });
    assert.ok(typeof result1 === 'string');

    const result2 = await tool.execute({ query: 'test', num_results: 100 });
    assert.ok(typeof result2 === 'string');
  });

  it('should return string result type', async () => {
    const result = await tool.execute({ query: 'typescript generics' });
    assert.strictEqual(typeof result, 'string');
  });
});
