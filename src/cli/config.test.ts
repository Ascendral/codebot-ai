import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { resolveConfig, resolveCapabilities } from './config';
import type { Config } from '../types';
import type { SavedConfig } from '../setup';

function emptyConfig(): Config {
  return {
    provider: 'openai',
    model: 'm',
    baseUrl: '',
    apiKey: '',
    maxIterations: 1,
    autoApprove: true,
  } as Config;
}

describe('resolveConfig — disableConstitutional wiring (Bug 2 regression)', () => {
  it('sets disableConstitutional=true when --no-constitutional is in args', async () => {
    const config = await resolveConfig({
      'no-constitutional': true,
      // Force a known model + base url so no auto-detect runs.
      model: 'claude-3-5-sonnet-20241022',
      'base-url': 'https://api.anthropic.com',
      'api-key': 'sk-test',
    });
    assert.strictEqual(config.disableConstitutional, true);
  });

  it('leaves disableConstitutional false when flag is absent', async () => {
    const config = await resolveConfig({
      model: 'claude-3-5-sonnet-20241022',
      'base-url': 'https://api.anthropic.com',
      'api-key': 'sk-test',
    });
    assert.strictEqual(!!config.disableConstitutional, false);
  });
});

describe('resolveCapabilities — persistent allowlist from config.json', () => {
  it('applies allowedCapabilities saved in config (no CLI flag needed)', () => {
    const config = emptyConfig();
    resolveCapabilities({}, config, {
      allowedCapabilities: ['write-fs', 'run-cmd', 'net-fetch'],
    } as SavedConfig);
    const allow = config.allowedCapabilities;
    assert.ok(allow, 'expected allowlist to be set from config');
    assert.ok(allow.has('write-fs'));
    assert.ok(allow.has('run-cmd'));
    assert.ok(allow.has('net-fetch'));
  });

  it('merges saved config allowlist with the --allow-capability flag', () => {
    const config = emptyConfig();
    resolveCapabilities({ 'allow-capability': 'account-access' }, config, {
      allowedCapabilities: ['write-fs'],
    } as SavedConfig);
    const allow = config.allowedCapabilities;
    assert.ok(allow, 'expected allowlist to be set');
    assert.ok(allow.has('write-fs'), 'config label kept');
    assert.ok(allow.has('account-access'), 'flag label added');
  });

  it('rejects a NEVER_ALLOWABLE label in config.json with an attributed error', () => {
    const config = emptyConfig();
    assert.throws(
      () => resolveCapabilities({}, config, { allowedCapabilities: ['move-money'] } as SavedConfig),
      /config\.json "allowedCapabilities".*move-money/s,
    );
  });

  it('rejects an unknown label in config.json', () => {
    const config = emptyConfig();
    assert.throws(
      () => resolveCapabilities({}, config, { allowedCapabilities: ['not-a-real-label'] } as SavedConfig),
      /config\.json "allowedCapabilities"/,
    );
  });

  it('leaves allowlist unset when neither source provides labels', () => {
    const config = emptyConfig();
    resolveCapabilities({}, config, {} as SavedConfig);
    assert.strictEqual(config.allowedCapabilities, undefined);
  });
});
