import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkSecretsForWrite } from './secret-guard';
import { PolicyEnforcer, loadPolicy } from './policy';
import { WriteFileTool } from './tools/write';
import { EditFileTool } from './tools/edit';

/**
 * P1-3 regression: until this commit, the default policy said
 * secrets.block_on_detect=true but the write/edit/batch-edit paths
 * still wrote the file and only appended a warning. checkSecretsForWrite
 * centralizes the enforcement. These tests lock it in.
 */
describe('checkSecretsForWrite — policy enforcement', () => {
  let tmp: string;
  let enforcer: PolicyEnforcer;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.homedir(), '.cb-test-sec-guard-'));
    enforcer = new PolicyEnforcer(loadPolicy(tmp), tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('block_on_detect=true (default): returns block=true + error on a real secret', () => {
    const content = 'const KEY = "sk_test_1234567890ABCDEFGHIJKLMNOPQRST";';
    const r = checkSecretsForWrite(content, enforcer, 'foo.ts');
    assert.strictEqual(r.block, true, 'should block on default policy');
    assert.ok(r.error && r.error.startsWith('Error: Blocked by policy'));
    assert.ok(r.error!.includes('foo.ts'));
    assert.ok(r.secrets.length > 0);
  });

  it('no secrets → no block, no warning', () => {
    const r = checkSecretsForWrite('const x = 1; // nothing sensitive', enforcer, 'clean.ts');
    assert.strictEqual(r.block, false);
    assert.strictEqual(r.warning, '');
    assert.strictEqual(r.secrets.length, 0);
    assert.strictEqual(r.error, undefined);
  });

  it('block_on_detect=false: warns but does not block', () => {
    // Write a policy file that disables blocking
    fs.mkdirSync(path.join(tmp, '.codebot'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.codebot', 'policy.json'),
      JSON.stringify({ secrets: { block_on_detect: false, scan_on_write: true } }),
    );
    const permissive = new PolicyEnforcer(loadPolicy(tmp), tmp);
    const content = 'const KEY = "sk_test_1234567890ABCDEFGHIJKLMNOPQRST";';
    const r = checkSecretsForWrite(content, permissive, 'foo.ts');
    assert.strictEqual(r.block, false, 'permissive policy should not block');
    assert.ok(r.warning.length > 0);
    assert.match(r.warning, /WARNING/);
  });

  it('scan_on_write=false: no scan at all', () => {
    fs.mkdirSync(path.join(tmp, '.codebot'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.codebot', 'policy.json'),
      JSON.stringify({ secrets: { scan_on_write: false } }),
    );
    const off = new PolicyEnforcer(loadPolicy(tmp), tmp);
    const content = 'const K = "sk_test_1234567890ABCDEFGHIJKLMNOPQRST";';
    const r = checkSecretsForWrite(content, off, 'foo.ts');
    assert.strictEqual(r.block, false);
    assert.strictEqual(r.warning, '');
    assert.strictEqual(r.secrets.length, 0);
  });

  it('no policy enforcer → fallback is warn-only (does not block)', () => {
    // Unit-test / standalone use case: no PolicyEnforcer provided.
    const content = 'const KEY = "sk_test_1234567890ABCDEFGHIJKLMNOPQRST";';
    const r = checkSecretsForWrite(content, undefined, 'standalone.ts');
    assert.strictEqual(r.block, false);
    assert.ok(r.warning.length > 0);
  });
});

describe('WriteFileTool — P1-3: refuses to persist secret under default policy', () => {
  let tmp: string;
  let enforcer: PolicyEnforcer;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.homedir(), '.cb-test-write-sec-'));
    enforcer = new PolicyEnforcer(loadPolicy(tmp), tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns error AND does not create the file when a secret is present', async () => {
    const tool = new WriteFileTool(enforcer, tmp);
    const target = path.join(tmp, 'leaky.ts');
    const out = await tool.execute({
      path: target,
      content: 'export const API_KEY = "sk_test_1234567890ABCDEFGHIJKLMNOPQRST";',
    });
    assert.match(out, /Blocked by policy/);
    assert.strictEqual(fs.existsSync(target), false, 'file MUST NOT exist after blocked write');
  });

  it('writes normally when content has no secrets', async () => {
    const tool = new WriteFileTool(enforcer, tmp);
    const target = path.join(tmp, 'clean.ts');
    const out = await tool.execute({
      path: target,
      content: 'export const PI = 3.14159;',
    });
    assert.match(out, /Created|Overwrote/);
    assert.strictEqual(fs.existsSync(target), true);
  });
});

describe('EditFileTool — P1-3: refuses to introduce a secret under default policy', () => {
  let tmp: string;
  let enforcer: PolicyEnforcer;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.homedir(), '.cb-test-edit-sec-'));
    enforcer = new PolicyEnforcer(loadPolicy(tmp), tmp);
    fs.writeFileSync(path.join(tmp, 'clean.ts'), 'export const PLACEHOLDER = "TODO";\n');
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('rejects an edit whose new_string contains a secret; file is untouched', async () => {
    const tool = new EditFileTool(enforcer, tmp);
    const target = path.join(tmp, 'clean.ts');
    const before = fs.readFileSync(target, 'utf-8');
    const out = await tool.execute({
      path: target,
      old_string: '"TODO"',
      new_string: '"sk_test_1234567890ABCDEFGHIJKLMNOPQRST"',
    });
    assert.match(out, /Blocked by policy/);
    assert.strictEqual(fs.readFileSync(target, 'utf-8'), before, 'file must be unchanged');
  });
});
