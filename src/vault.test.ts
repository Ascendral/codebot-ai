import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Redirect vault to temp location for tests
const VAULT_DIR = path.join(os.tmpdir(), 'codebot-vault-test-' + Date.now());
const VAULT_FILE = path.join(VAULT_DIR, 'vault.json');

describe('VaultManager', () => {
  before(() => {
    fs.mkdirSync(VAULT_DIR, { recursive: true });
    process.env.CODEBOT_VAULT_KEY = 'test-vault-passphrase-123';
  });

  after(() => {
    fs.rmSync(VAULT_DIR, { recursive: true, force: true });
    delete process.env.CODEBOT_VAULT_KEY;
  });

  it('starts with empty vault', async () => {
    const { VaultManager } = await import('./vault');
    const vault = new VaultManager();
    assert.deepStrictEqual(vault.list(), []);
  });

  it('sets and gets a credential', async () => {
    const { VaultManager } = await import('./vault');
    const vault = new VaultManager();
    vault.set('github', {
      type: 'api_key',
      value: 'ghp_test123',
      metadata: { provider: 'GitHub', created: new Date().toISOString() },
    });
    const cred = vault.get('github');
    assert.ok(cred);
    assert.strictEqual(cred!.name, 'github');
    assert.strictEqual(cred!.value, 'ghp_test123');
    assert.strictEqual(cred!.type, 'api_key');
  });

  it('list returns names only', async () => {
    const { VaultManager } = await import('./vault');
    const vault = new VaultManager();
    vault.set('test-cred', {
      type: 'api_key',
      value: 'secret-value',
      metadata: { provider: 'Test', created: new Date().toISOString() },
    });
    const names = vault.list();
    assert.ok(names.includes('test-cred'));
    // Ensure values are NOT returned
    assert.ok(!names.includes('secret-value'));
  });

  it('has returns true for existing credential', async () => {
    const { VaultManager } = await import('./vault');
    const vault = new VaultManager();
    vault.set('exists', {
      type: 'api_key',
      value: 'val',
      metadata: { provider: 'Test', created: new Date().toISOString() },
    });
    assert.ok(vault.has('exists'));
    assert.ok(!vault.has('nonexistent'));
  });

  it('delete removes a credential', async () => {
    const { VaultManager } = await import('./vault');
    const vault = new VaultManager();
    vault.set('to-delete', {
      type: 'api_key',
      value: 'val',
      metadata: { provider: 'Test', created: new Date().toISOString() },
    });
    assert.ok(vault.has('to-delete'));
    const removed = vault.delete('to-delete');
    assert.ok(removed);
    assert.ok(!vault.has('to-delete'));
  });

  it('delete returns false for nonexistent credential', async () => {
    const { VaultManager } = await import('./vault');
    const vault = new VaultManager();
    assert.strictEqual(vault.delete('nonexistent'), false);
  });

  it('overwrites existing credential with set', async () => {
    const { VaultManager } = await import('./vault');
    const vault = new VaultManager();
    vault.set('overwrite', {
      type: 'api_key',
      value: 'old-value',
      metadata: { provider: 'Test', created: new Date().toISOString() },
    });
    vault.set('overwrite', {
      type: 'api_key',
      value: 'new-value',
      metadata: { provider: 'Test', created: new Date().toISOString() },
    });
    const cred = vault.get('overwrite');
    assert.strictEqual(cred!.value, 'new-value');
  });

  it('get returns undefined for nonexistent credential', async () => {
    const { VaultManager } = await import('./vault');
    const vault = new VaultManager();
    assert.strictEqual(vault.get('nonexistent'), undefined);
  });
});
