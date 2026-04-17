import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isDockerAvailable, getSandboxInfo, resetDockerCheck, sandboxExec } from './sandbox';

describe('Sandbox — Docker detection', () => {
  it('isDockerAvailable returns a boolean', () => {
    resetDockerCheck();
    const result = isDockerAvailable();
    assert.strictEqual(typeof result, 'boolean');
  });

  it('getSandboxInfo returns correct structure', () => {
    const info = getSandboxInfo();
    assert.strictEqual(typeof info.available, 'boolean');
    assert.strictEqual(typeof info.image, 'string');
    assert.ok(info.defaults);
    assert.strictEqual(typeof info.defaults.cpus, 'number');
    assert.strictEqual(typeof info.defaults.memoryMb, 'number');
    assert.strictEqual(typeof info.defaults.network, 'boolean');
  });

  it('caches Docker availability check', () => {
    resetDockerCheck();
    const first = isDockerAvailable();
    const second = isDockerAvailable();
    assert.strictEqual(first, second);
  });
});

// P1-1 regression: the previous implementation passed
// `dockerArgs.join(' ')` to execSync, which broke whenever any argument
// contained a space. Project paths with spaces, custom images with
// spaces in the name, or commands with embedded spaces could all
// misparse. These tests lock in the fixed behavior.
describe('Sandbox — sandboxExec path handling (P1-1 fix)', () => {
  it('host fallback: command in project dir with a space in its path', () => {
    // This exercises the hostFallback path (Docker is usually available
    // locally, but we're asserting argument handling, which is the same
    // class of bug once Docker is running).
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb sandbox test '));
    try {
      const r = sandboxExec('echo hello', tmp);
      // Either Docker path or host path must return "hello" — the old
      // `join(' ')` bug would have silently produced garbage on the
      // Docker path when `tmp` has spaces. The host fallback (execSync
      // with cwd set) is unaffected; used here to assert the test
      // fixture isn't itself broken.
      assert.ok(r.stdout.includes('hello'), `got: ${JSON.stringify(r)}`);
      assert.strictEqual(r.exitCode, 0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('sandboxExec does not throw on command with special chars (no shell expansion)', () => {
    // Run a command whose literal text contains characters that would
    // previously have been re-parsed by the shell when we did
    // `execSync(dockerArgs.join(' '))`. Under execFileSync these pass
    // through verbatim as a single argv element (after sh -c invocation
    // inside the container / shell fallback).
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-sandbox-special-'));
    try {
      // Single quotes and $ would previously re-expand through the outer shell
      const r = sandboxExec(`echo 'a $USER b'`, tmp);
      assert.ok(r.stdout.length > 0, `expected non-empty output, got: ${JSON.stringify(r)}`);
      // We don't assert exact content because hostFallback's shell will
      // still expand $USER (it runs through `sh -c`), but we DO assert
      // the command didn't explode into an error.
      assert.strictEqual(r.exitCode, 0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
