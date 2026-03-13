import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

describe('codebotPath()', () => {
  const origHome = process.env.CODEBOT_HOME;

  after(() => {
    if (origHome !== undefined) {
      process.env.CODEBOT_HOME = origHome;
    } else {
      delete process.env.CODEBOT_HOME;
    }
  });

  it('defaults to ~/.codebot', () => {
    delete process.env.CODEBOT_HOME;
    // Re-import to get fresh evaluation
    const { codebotHome, codebotPath } = require('./paths');
    assert.strictEqual(codebotHome(), path.join(os.homedir(), '.codebot'));
    assert.strictEqual(codebotPath('sessions'), path.join(os.homedir(), '.codebot', 'sessions'));
  });

  it('respects CODEBOT_HOME env var', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebot-paths-test-'));
    process.env.CODEBOT_HOME = tmpDir;
    const { codebotHome, codebotPath } = require('./paths');
    assert.strictEqual(codebotHome(), tmpDir);
    assert.strictEqual(codebotPath('vault.json'), path.join(tmpDir, 'vault.json'));
    assert.strictEqual(codebotPath('sessions', 'abc.jsonl'), path.join(tmpDir, 'sessions', 'abc.jsonl'));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('warnNonFatal()', () => {
  it('writes to stderr', () => {
    const { warnNonFatal, resetWarnings } = require('./warn');
    resetWarnings();
    delete process.env.CODEBOT_QUIET;

    let captured = '';
    const origWrite = process.stderr.write;
    process.stderr.write = (chunk: string | Uint8Array) => {
      captured += chunk.toString();
      return true;
    };

    warnNonFatal('test.context', new Error('test error'));
    process.stderr.write = origWrite;

    assert.ok(captured.includes('[codebot:warn]'));
    assert.ok(captured.includes('test.context'));
    assert.ok(captured.includes('test error'));
  });

  it('deduplicates warnings', () => {
    const { warnNonFatal, resetWarnings } = require('./warn');
    resetWarnings();
    delete process.env.CODEBOT_QUIET;

    let count = 0;
    const origWrite = process.stderr.write;
    process.stderr.write = () => { count++; return true; };

    warnNonFatal('dup.test', 'same error');
    warnNonFatal('dup.test', 'same error');
    warnNonFatal('dup.test', 'same error');
    process.stderr.write = origWrite;

    assert.strictEqual(count, 1);
  });

  it('suppressed by CODEBOT_QUIET=1', () => {
    const { warnNonFatal, resetWarnings } = require('./warn');
    resetWarnings();
    process.env.CODEBOT_QUIET = '1';

    let captured = '';
    const origWrite = process.stderr.write;
    process.stderr.write = (chunk: string | Uint8Array) => {
      captured += chunk.toString();
      return true;
    };

    warnNonFatal('quiet.test', 'should not appear');
    process.stderr.write = origWrite;
    delete process.env.CODEBOT_QUIET;

    assert.strictEqual(captured, '');
  });
});

describe('CODEBOT_HOME isolation', () => {
  let tmpDir: string;
  const origHome = process.env.CODEBOT_HOME;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebot-isolation-test-'));
    process.env.CODEBOT_HOME = tmpDir;
  });

  after(() => {
    if (origHome !== undefined) {
      process.env.CODEBOT_HOME = origHome;
    } else {
      delete process.env.CODEBOT_HOME;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('SessionManager writes to CODEBOT_HOME', () => {
    const { SessionManager } = require('./history');
    const mgr = new SessionManager('test-model');
    mgr.save({ role: 'user', content: 'hello' });
    const sessionsDir = path.join(tmpDir, 'sessions');
    assert.ok(fs.existsSync(sessionsDir), 'sessions dir should exist under CODEBOT_HOME');
    const files = fs.readdirSync(sessionsDir);
    assert.ok(files.length > 0, 'should have at least one session file');
  });

  it('VaultManager writes to CODEBOT_HOME', () => {
    const { VaultManager } = require('./vault');
    const vault = new VaultManager();
    vault.set('test-cred', {
      type: 'api_key',
      value: 'test-value',
      metadata: { provider: 'test', created: new Date().toISOString() },
    });
    assert.ok(fs.existsSync(path.join(tmpDir, 'vault.json')), 'vault.json should exist under CODEBOT_HOME');
  });

  it('loadConfig reads from CODEBOT_HOME', () => {
    const { loadConfig, saveConfig } = require('./setup');
    saveConfig({ model: 'test-model', provider: 'test' });
    assert.ok(fs.existsSync(path.join(tmpDir, 'config.json')), 'config.json should exist under CODEBOT_HOME');
    const loaded = loadConfig();
    assert.strictEqual(loaded.model, 'test-model');
  });
});
