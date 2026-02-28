import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AuditLogger } from './audit';

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `codebot-audit-test-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir: string) {
  try { fs.rmSync(dir, { recursive: true }); } catch { /* ok */ }
}

describe('AuditLogger', () => {
  it('writes JSONL entries', () => {
    const dir = makeTempDir();
    try {
      const logger = new AuditLogger(dir);
      logger.log({ tool: 'read_file', action: 'execute', args: { path: '/foo.ts' }, result: 'success' });

      const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
      assert.ok(files.length > 0, 'Should create a log file');

      const content = fs.readFileSync(path.join(dir, files[0]), 'utf-8');
      const entry = JSON.parse(content.trim());
      assert.strictEqual(entry.tool, 'read_file');
      assert.strictEqual(entry.action, 'execute');
    } finally {
      cleanup(dir);
    }
  });

  it('includes all required fields', () => {
    const dir = makeTempDir();
    try {
      const logger = new AuditLogger(dir);
      logger.log({ tool: 'write_file', action: 'execute', args: { path: '/bar.ts' } });

      const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
      const content = fs.readFileSync(path.join(dir, files[0]), 'utf-8');
      const entry = JSON.parse(content.trim());

      assert.ok(entry.timestamp, 'Should have timestamp');
      assert.ok(entry.sessionId, 'Should have sessionId');
      assert.strictEqual(entry.tool, 'write_file');
      assert.strictEqual(entry.action, 'execute');
      assert.ok(entry.args, 'Should have args');
    } finally {
      cleanup(dir);
    }
  });

  it('masks secrets in args', () => {
    const dir = makeTempDir();
    try {
      const logger = new AuditLogger(dir);
      logger.log({
        tool: 'write_file',
        action: 'execute',
        args: { path: '/config.ts', content: 'api_key = AKIAIOSFODNN7EXAMPLE' },
      });

      const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
      const content = fs.readFileSync(path.join(dir, files[0]), 'utf-8');
      assert.ok(!content.includes('AKIAIOSFODNN7EXAMPLE'), 'Full secret should be masked in logs');
      assert.ok(content.includes('****'), 'Should contain mask characters');
    } finally {
      cleanup(dir);
    }
  });

  it('survives write errors without throwing', () => {
    // Use a read-only directory path that doesn't exist
    const logger = new AuditLogger('/nonexistent/audit/path');
    // This should NOT throw
    assert.doesNotThrow(() => {
      logger.log({ tool: 'test', action: 'execute', args: {} });
    });
  });

  it('returns correct session ID', () => {
    const dir = makeTempDir();
    try {
      const logger = new AuditLogger(dir);
      const sessionId = logger.getSessionId();
      assert.ok(sessionId.length > 0, 'Session ID should not be empty');
      assert.ok(sessionId.includes('-'), 'Session ID should contain a dash');
    } finally {
      cleanup(dir);
    }
  });

  it('query returns logged entries', () => {
    const dir = makeTempDir();
    try {
      const logger = new AuditLogger(dir);
      logger.log({ tool: 'read_file', action: 'execute', args: { path: '/a.ts' } });
      logger.log({ tool: 'write_file', action: 'security_block', args: { path: '/etc/passwd' }, reason: 'blocked' });
      logger.log({ tool: 'edit_file', action: 'deny', args: { path: '/b.ts' } });

      const all = logger.query();
      assert.strictEqual(all.length, 3);

      const blocks = logger.query({ action: 'security_block' });
      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].tool, 'write_file');
    } finally {
      cleanup(dir);
    }
  });
});
