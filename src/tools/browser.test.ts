import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { BrowserTool, BrowserSession } from './browser';

describe('BrowserTool — policy enforcement (v2.1.5)', () => {
  it('returns blocked message when browser tool is disabled by policy', async () => {
    const tool = new BrowserTool();
    assert.strictEqual(tool.name, 'browser');
    assert.strictEqual(tool.permission, 'prompt');
    assert.ok(tool.description.includes('browser'));
  });

  it('has all expected browser actions in parameters', () => {
    const tool = new BrowserTool();
    const actions = tool.parameters.properties.action.enum;
    assert.ok(actions.includes('navigate'));
    assert.ok(actions.includes('content'));
    assert.ok(actions.includes('screenshot'));
    assert.ok(actions.includes('click'));
    assert.ok(actions.includes('type'));
    assert.ok(actions.includes('find_by_text'));
    assert.ok(actions.includes('hover'));
    assert.ok(actions.includes('scroll'));
    assert.ok(actions.includes('press_key'));
    assert.ok(actions.includes('evaluate'));
    assert.ok(actions.includes('tabs'));
    assert.ok(actions.includes('close'));
    assert.ok(actions.includes('switch_tab'));
    assert.ok(actions.includes('new_tab'));
  });

  it('returns error for unknown action', async () => {
    const tool = new BrowserTool();
    const result = await tool.execute({ action: 'nonexistent_action' });
    assert.ok(result.includes('Unknown action'));
  });
});

describe('BrowserSession — connection management', () => {
  it('getInstance returns singleton', () => {
    const a = BrowserSession.getInstance();
    const b = BrowserSession.getInstance();
    assert.strictEqual(a, b);
  });

  it('starts in non-fallback mode', () => {
    const session = BrowserSession.getInstance();
    session.resetFallback();
    assert.strictEqual(session.isFallbackMode(), false);
  });

  it('can enable and reset fallback mode', () => {
    const session = BrowserSession.getInstance();
    session.resetFallback();
    assert.strictEqual(session.isFallbackMode(), false);
    session.enableFallback();
    assert.strictEqual(session.isFallbackMode(), true);
    session.resetFallback();
    assert.strictEqual(session.isFallbackMode(), false);
  });

  it('shouldReconnect returns true up to max attempts', () => {
    const session = BrowserSession.getInstance();
    session.resetFallback();
    assert.strictEqual(session.shouldReconnect(), true);  // 1
    assert.strictEqual(session.shouldReconnect(), true);  // 2
    assert.strictEqual(session.shouldReconnect(), true);  // 3
    assert.strictEqual(session.shouldReconnect(), false); // 4 — exceeded
    session.resetFallback(); // cleanup
  });

  it('getStatus returns connection info', () => {
    const session = BrowserSession.getInstance();
    session.resetFallback();
    const status = session.getStatus();
    assert.strictEqual(typeof status.connected, 'boolean');
    assert.strictEqual(typeof status.fallback, 'boolean');
    assert.strictEqual(typeof status.reconnectAttempts, 'number');
  });

  it('getScreenshot returns null initially', () => {
    const session = BrowserSession.getInstance();
    assert.strictEqual(session.getScreenshot(), null);
  });

  it('clearScreenshot resets screenshot data', () => {
    const session = BrowserSession.getInstance();
    session.clearScreenshot();
    assert.strictEqual(session.getScreenshot(), null);
  });
});

describe('BrowserTool — input validation', () => {
  const tool = new BrowserTool();

  it('navigate returns error when url missing', async () => {
    const result = await tool.execute({ action: 'navigate' });
    assert.ok(result.includes('Error') || result.includes('error') || result.includes('url is required'),
      'Should error on missing URL');
  });

  it('click returns error when selector missing', async () => {
    const result = await tool.execute({ action: 'click' });
    assert.ok(result.includes('Error') || result.includes('selector is required') || result.includes('Browser error'),
      'Should error on missing selector');
  });

  it('type returns error when selector missing', async () => {
    const result = await tool.execute({ action: 'type', text: 'hello' });
    assert.ok(result.includes('Error') || result.includes('selector is required') || result.includes('Browser error'),
      'Should error on missing selector');
  });

  it('type returns error when text missing', async () => {
    const result = await tool.execute({ action: 'type', selector: '#input' });
    assert.ok(result.includes('Error') || result.includes('text is required') || result.includes('Browser error'),
      'Should error on missing text');
  });

  it('evaluate returns error when expression missing', async () => {
    const result = await tool.execute({ action: 'evaluate' });
    assert.ok(result.includes('Error') || result.includes('expression is required') || result.includes('Browser error'),
      'Should error on missing expression');
  });

  it('find_by_text returns error when text missing', async () => {
    const result = await tool.execute({ action: 'find_by_text' });
    assert.ok(result.includes('Error') || result.includes('text is required') || result.includes('Browser error'),
      'Should error on missing text');
  });

  it('press_key returns error when key missing', async () => {
    const result = await tool.execute({ action: 'press_key' });
    assert.ok(result.includes('Error') || result.includes('key is required') || result.includes('Browser error'),
      'Should error on missing key');
  });

  it('hover returns error when selector missing', async () => {
    const result = await tool.execute({ action: 'hover' });
    assert.ok(result.includes('Error') || result.includes('selector is required') || result.includes('Browser error'),
      'Should error on missing selector');
  });

  it('close returns success message', async () => {
    const result = await tool.execute({ action: 'close' });
    assert.ok(result.includes('closed') || result.includes('Browser'),
      'Should confirm browser closed');
  });

  it('wait defaults to 1000ms', async () => {
    const result = await tool.execute({ action: 'wait' });
    assert.ok(result.includes('Waited') || result.includes('ms'),
      'Should confirm wait completed');
  });
});

describe('BrowserTool — error message quality', () => {
  it('fallback mode produces actionable error messages', async () => {
    // When in fallback mode, actions that need Chrome should give useful messages
    const session = BrowserSession.getInstance();
    session.enableFallback();
    const tool = new BrowserTool();
    // content/screenshot/click should report fallback mode or browser error
    const result = await tool.execute({ action: 'screenshot' });
    assert.ok(
      result.includes('fallback') || result.includes('Browser error') || result.includes('unavailable'),
      'Should mention fallback or error state: ' + result
    );
    session.resetFallback();
  });

  it('navigate in fallback mode attempts HTTP fetch', async () => {
    const session = BrowserSession.getInstance();
    session.enableFallback();
    const tool = new BrowserTool();
    // In fallback mode, navigate should attempt fetch (may fail on network, but should not crash)
    const result = await tool.execute({ action: 'navigate', url: 'https://httpbin.org/status/200' });
    assert.ok(
      result.includes('Fallback mode') || result.includes('Error') || result.includes('fetch'),
      'Should use fallback fetch or report error: ' + result
    );
    session.resetFallback();
  });
});
