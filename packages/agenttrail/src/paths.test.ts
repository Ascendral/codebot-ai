import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

describe('trailPath()', () => {
  const origHome = process.env.AGENTTRAIL_HOME;

  after(() => {
    if (origHome !== undefined) {
      process.env.AGENTTRAIL_HOME = origHome;
    } else {
      delete process.env.AGENTTRAIL_HOME;
    }
  });

  it('defaults to ~/.agenttrail', () => {
    delete process.env.AGENTTRAIL_HOME;
    // Re-import to get fresh evaluation
    const { trailHome, trailPath } = require('./paths');
    assert.strictEqual(trailHome(), path.join(os.homedir(), '.agenttrail'));
    assert.strictEqual(trailPath('sessions'), path.join(os.homedir(), '.agenttrail', 'sessions'));
  });

  it('respects AGENTTRAIL_HOME env var', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenttrail-paths-test-'));
    process.env.AGENTTRAIL_HOME = tmpDir;
    const { trailHome, trailPath } = require('./paths');
    assert.strictEqual(trailHome(), tmpDir);
    assert.strictEqual(trailPath('vault.json'), path.join(tmpDir, 'vault.json'));
    assert.strictEqual(trailPath('sessions', 'abc.jsonl'), path.join(tmpDir, 'sessions', 'abc.jsonl'));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('warnNonFatal()', () => {
  it('writes to stderr', () => {
    const { warnNonFatal, resetWarnings } = require('./warn');
    resetWarnings();
    delete process.env.AGENTTRAIL_QUIET;

    let captured = '';
    const origWrite = process.stderr.write;
    process.stderr.write = (chunk: string | Uint8Array) => {
      captured += chunk.toString();
      return true;
    };

    warnNonFatal('test.context', new Error('test error'));
    process.stderr.write = origWrite;

    assert.ok(captured.includes('[agenttrail:warn]'));
    assert.ok(captured.includes('test.context'));
    assert.ok(captured.includes('test error'));
  });

  it('deduplicates warnings', () => {
    const { warnNonFatal, resetWarnings } = require('./warn');
    resetWarnings();
    delete process.env.AGENTTRAIL_QUIET;

    let count = 0;
    const origWrite = process.stderr.write;
    process.stderr.write = () => { count++; return true; };

    warnNonFatal('dup.test', 'same error');
    warnNonFatal('dup.test', 'same error');
    warnNonFatal('dup.test', 'same error');
    process.stderr.write = origWrite;

    assert.strictEqual(count, 1);
  });

  it('suppressed by AGENTTRAIL_QUIET=1', () => {
    const { warnNonFatal, resetWarnings } = require('./warn');
    resetWarnings();
    process.env.AGENTTRAIL_QUIET = '1';

    let captured = '';
    const origWrite = process.stderr.write;
    process.stderr.write = (chunk: string | Uint8Array) => {
      captured += chunk.toString();
      return true;
    };

    warnNonFatal('quiet.test', 'should not appear');
    process.stderr.write = origWrite;
    delete process.env.AGENTTRAIL_QUIET;

    assert.strictEqual(captured, '');
  });
});

describe('AGENTTRAIL_HOME isolation', () => {
  let tmpDir: string;
  const origHome = process.env.AGENTTRAIL_HOME;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenttrail-isolation-test-'));
    process.env.AGENTTRAIL_HOME = tmpDir;
  });

  after(() => {
    if (origHome !== undefined) {
      process.env.AGENTTRAIL_HOME = origHome;
    } else {
      delete process.env.AGENTTRAIL_HOME;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // The origin repo's versions of these tests exercised SessionManager,
  // VaultManager, and loadConfig — agent-side modules that stay behind.
  // This package's consumers of trailHome are audit + encryption; both
  // have their own isolation coverage in their suites.
  it('AuditLogger writes under AGENTTRAIL_HOME', () => {
    const { AuditLogger } = require('./audit');
    const logger = new AuditLogger(); // no logDir → defaults to trailPath('audit')
    logger.log({ tool: 'execute', action: 'execute', args: { command: 'ls' } });
    assert.ok(
      fs.existsSync(path.join(tmpDir, 'audit')),
      'audit dir should exist under AGENTTRAIL_HOME'
    );
  });
});
