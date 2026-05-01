/**
 * Tests for electron/api-key-resolver.js — the PR 28.5 provider-aware
 * API-key resolver.
 *
 * The bug we're regression-testing:
 *   ~/.codebot/config.json shaped like
 *     {
 *       provider: 'anthropic',
 *       apiKey:           'sk-proj-…',   // legacy slot, holds OPENAI key
 *       anthropicApiKey:  'sk-ant-…',    // correct slot, holds Anthropic key
 *       openaiApiKey:     'sk-proj-…',
 *     }
 *   The old resolver returned `config.apiKey` (sk-proj-…) as the Anthropic
 *   key; Electron passed it to the dashboard subprocess as
 *   ANTHROPIC_API_KEY; Anthropic returned 401; the dashboard banner showed
 *   "API key is invalid or expired."
 *
 *   The new resolver MUST prefer config.anthropicApiKey here.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { resolveKey, resolveAll, looksLike } = require('./api-key-resolver');

describe('api-key-resolver — looksLike', () => {
  it('classifies anthropic, openai, gemini key shapes', () => {
    assert.strictEqual(looksLike('anthropic', 'sk-ant-api03-abc'), true);
    assert.strictEqual(looksLike('anthropic', 'sk-proj-abc'),       false);
    assert.strictEqual(looksLike('anthropic', 'AIzaSy123'),         false);
    assert.strictEqual(looksLike('openai', 'sk-proj-abc'),          true);
    assert.strictEqual(looksLike('openai', 'sk-abc'),               true);
    assert.strictEqual(looksLike('openai', 'sk-ant-api03-abc'),     false);
    assert.strictEqual(looksLike('gemini', 'AIzaSy123'),            true);
    assert.strictEqual(looksLike('gemini', 'sk-ant-api03'),         false);
  });

  it('rejects empty / non-string inputs', () => {
    assert.strictEqual(looksLike('anthropic', ''),        false);
    assert.strictEqual(looksLike('anthropic', null),      false);
    assert.strictEqual(looksLike('anthropic', undefined), false);
    assert.strictEqual(looksLike('anthropic', 12345),     false);
  });
});

describe('api-key-resolver — resolveKey priority order', () => {
  it('process.env beats config beats .env file beats legacy apiKey', () => {
    const env      = { ANTHROPIC_API_KEY: 'env-key' };
    const config   = { provider: 'anthropic', anthropicApiKey: 'config-key', apiKey: 'sk-ant-legacy' };
    const envFiles = { ANTHROPIC_API_KEY: 'envfile-key' };
    const r = resolveKey('anthropic', { env, config, envFiles });
    assert.strictEqual(r.key, 'env-key');
    assert.strictEqual(r.source, 'env:ANTHROPIC_API_KEY');
  });

  it('config wins when env empty', () => {
    const r = resolveKey('anthropic', {
      env:      { ANTHROPIC_API_KEY: '' },
      config:   { provider: 'anthropic', anthropicApiKey: 'config-key', apiKey: 'sk-ant-legacy' },
      envFiles: { ANTHROPIC_API_KEY: 'envfile-key' },
    });
    assert.strictEqual(r.key, 'config-key');
    assert.strictEqual(r.source, 'config:anthropicApiKey');
  });

  it('env file wins when env + config empty', () => {
    const r = resolveKey('anthropic', {
      env:      {},
      config:   {},
      envFiles: { ANTHROPIC_API_KEY: 'envfile-key' },
    });
    assert.strictEqual(r.key, 'envfile-key');
    assert.strictEqual(r.source, 'envfile:ANTHROPIC_API_KEY');
  });
});

describe('api-key-resolver — legacy apiKey slot is GUARDED', () => {
  it('THE BUG: provider=anthropic + apiKey holds OpenAI key → resolver ignores it', () => {
    const config = {
      provider:        'anthropic',
      apiKey:          'sk-proj-this-is-an-openai-key', // wrong shape
      anthropicApiKey: 'sk-ant-api03-real-anthropic',
    };
    const r = resolveKey('anthropic', { env: {}, config, envFiles: {} });
    // Resolver MUST pick the provider-specific slot, NOT the legacy one.
    assert.strictEqual(r.key, 'sk-ant-api03-real-anthropic');
    assert.strictEqual(r.source, 'config:anthropicApiKey');
  });

  it('legacy apiKey accepted ONLY when provider matches AND shape matches', () => {
    const config = { provider: 'anthropic', apiKey: 'sk-ant-api03-legacy-anthropic' };
    const r = resolveKey('anthropic', { env: {}, config, envFiles: {} });
    assert.strictEqual(r.key, 'sk-ant-api03-legacy-anthropic');
    assert.strictEqual(r.source, 'config:apiKey(legacy)');
  });

  it('legacy apiKey REJECTED when provider matches but shape mismatches', () => {
    // Same bug as above but without the provider-specific slot present.
    const config = { provider: 'anthropic', apiKey: 'sk-proj-openai-key-no-anthropic-slot' };
    const r = resolveKey('anthropic', { env: {}, config, envFiles: {} });
    assert.strictEqual(r.key, null,
      'should refuse a non-anthropic-shaped key from the legacy slot');
  });

  it('legacy apiKey REJECTED when provider does not match', () => {
    const config = { provider: 'openai', apiKey: 'sk-ant-api03-anthropic-key' };
    const r = resolveKey('anthropic', { env: {}, config, envFiles: {} });
    assert.strictEqual(r.key, null,
      'should refuse legacy slot when config.provider !== requested provider');
  });
});

describe('api-key-resolver — resolveAll', () => {
  it('resolves all three providers from a single config', () => {
    const env      = {};
    const config   = {
      provider:        'anthropic',
      apiKey:          'sk-proj-openai-key',     // OpenAI key in legacy slot
      anthropicApiKey: 'sk-ant-api03-anthropic',
      openaiApiKey:    'sk-proj-real-openai',
      geminiApiKey:    'AIzaSyGemini',
    };
    const r = resolveAll({ env, config, envFiles: {} });
    assert.strictEqual(r.anthropic.key, 'sk-ant-api03-anthropic');
    assert.strictEqual(r.anthropic.source, 'config:anthropicApiKey');
    assert.strictEqual(r.openai.key, 'sk-proj-real-openai');
    assert.strictEqual(r.openai.source, 'config:openaiApiKey');
    assert.strictEqual(r.gemini.key, 'AIzaSyGemini');
    assert.strictEqual(r.gemini.source, 'config:geminiApiKey');
  });

  it('returns null source when nothing found', () => {
    const r = resolveAll({ env: {}, config: {}, envFiles: {} });
    assert.strictEqual(r.anthropic.key, null);
    assert.strictEqual(r.anthropic.source, null);
    assert.strictEqual(r.openai.key, null);
    assert.strictEqual(r.gemini.key, null);
  });

  it('regression: exact bug repro from Alex\'s ~/.codebot/config.json', () => {
    // Exact shape that triggered the "API key is invalid or expired" banner.
    const config = {
      provider:        'anthropic',
      model:           'claude-sonnet-4-6',
      apiKey:          'sk-proj-6yxVWuDzFqGA9kNzZVaAx_yHHxJdn5Rwxkfbh7JX',
      openaiApiKey:    'sk-proj-6yxVWuDzFqGA9kNzZVaAx_yHHxJdn5Rwxkfbh7JX',
      anthropicApiKey: 'sk-ant-api03-qaKV5ts5N25Johrdw45_eSK0CzFfDz',
      geminiApiKey:    'AIzaSyCHyM_Kq6ao0PAwfgBrTKEO2TZ0ENT38H4',
    };
    const r = resolveAll({ env: {}, config, envFiles: {} });
    // Anthropic MUST come from the anthropic slot, not the legacy slot.
    assert.ok(r.anthropic.key.startsWith('sk-ant-'),
      `anthropic key should start with sk-ant-, got ${r.anthropic.key.slice(0, 10)}…`);
    assert.strictEqual(r.anthropic.source, 'config:anthropicApiKey');
  });
});

describe('api-key-resolver — defensive', () => {
  it('handles unknown provider gracefully', () => {
    const r = resolveKey('does-not-exist', { env: {}, config: {}, envFiles: {} });
    assert.strictEqual(r.key, null);
    assert.strictEqual(r.source, null);
  });

  it('treats undefined inputs as empty', () => {
    const r = resolveKey('anthropic', {});
    assert.strictEqual(r.key, null);
  });
});
