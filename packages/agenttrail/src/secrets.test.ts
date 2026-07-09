import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { scanForSecrets, hasSecrets, maskSecretsInString } from './secrets';

describe('scanForSecrets', () => {
  it('detects AWS access keys', () => {
    const content = 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE';
    const matches = scanForSecrets(content);
    assert.ok(matches.length > 0, 'Should detect AWS access key');
    assert.strictEqual(matches[0].type, 'aws_access_key');
  });

  it('detects private keys', () => {
    const content = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCA...';
    const matches = scanForSecrets(content);
    assert.ok(matches.length > 0, 'Should detect private key');
    assert.strictEqual(matches[0].type, 'private_key');
  });

  it('detects GitHub tokens (ghp_)', () => {
    const content = 'GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';
    const matches = scanForSecrets(content);
    assert.ok(matches.length > 0, 'Should detect GitHub token');
    assert.strictEqual(matches[0].type, 'github_token');
  });

  it('detects JWTs', () => {
    const content = 'token = eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123signature';
    const matches = scanForSecrets(content);
    assert.ok(matches.length > 0, 'Should detect JWT');
    assert.strictEqual(matches[0].type, 'jwt');
  });

  it('detects connection strings', () => {
    const content = 'DATABASE_URL=mongodb://user:pass@host:27017/db';
    const matches = scanForSecrets(content);
    assert.ok(matches.length > 0, 'Should detect connection string');
    assert.strictEqual(matches[0].type, 'connection_string');
  });

  it('detects Stripe secret keys', () => {
    const content = 'stripe_key = sk_test_FAKEKEYFORTESTINGONLY0000';
    const matches = scanForSecrets(content);
    assert.ok(matches.length > 0, 'Should detect Stripe key');
    assert.strictEqual(matches[0].type, 'stripe_key');
  });

  it('returns correct line numbers', () => {
    const content = 'line1\nline2\nAKIAIOSFODNN7EXAMPLE\nline4';
    const matches = scanForSecrets(content);
    assert.ok(matches.length > 0);
    assert.strictEqual(matches[0].line, 3, 'Should be on line 3');
  });

  it('masks secrets in snippets', () => {
    const content = 'key = AKIAIOSFODNN7EXAMPLE';
    const matches = scanForSecrets(content);
    assert.ok(matches.length > 0);
    assert.ok(matches[0].snippet.includes('****'), `Snippet should be masked: ${matches[0].snippet}`);
    assert.ok(!matches[0].snippet.includes('AKIAIOSFODNN7EXAMPLE'), 'Full key should not appear in snippet');
  });

  it('ignores safe content with no secrets', () => {
    const content = `const x = 42;
function hello() {
  return 'world';
}
// This is a normal file`;
    const matches = scanForSecrets(content);
    assert.strictEqual(matches.length, 0, 'Normal code should have no matches');
  });
});

describe('hasSecrets', () => {
  it('returns true for content with secrets', () => {
    assert.strictEqual(hasSecrets('key = AKIAIOSFODNN7EXAMPLE'), true);
  });

  it('returns false for safe content', () => {
    assert.strictEqual(hasSecrets('const x = 42;'), false);
  });
});

describe('maskSecretsInString', () => {
  it('masks secrets in arbitrary text', () => {
    const text = 'Connecting with AKIAIOSFODNN7EXAMPLE to AWS';
    const masked = maskSecretsInString(text);
    assert.ok(!masked.includes('AKIAIOSFODNN7EXAMPLE'), 'Full key should be masked');
    assert.ok(masked.includes('****'), 'Should contain mask characters');
  });
});
