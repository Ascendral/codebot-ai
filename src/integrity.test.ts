import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { deriveSessionKey, signMessage, verifyMessage, verifyMessages } from './integrity';

describe('deriveSessionKey', () => {
  it('returns consistent key for same session', () => {
    const key1 = deriveSessionKey('session-123');
    const key2 = deriveSessionKey('session-123');
    assert.deepStrictEqual(key1, key2);
  });

  it('returns different keys for different sessions', () => {
    const key1 = deriveSessionKey('session-a');
    const key2 = deriveSessionKey('session-b');
    assert.notDeepStrictEqual(key1, key2);
  });

  it('returns a 32-byte Buffer (SHA-256)', () => {
    const key = deriveSessionKey('test-session');
    assert.ok(Buffer.isBuffer(key));
    assert.strictEqual(key.length, 32);
  });
});

describe('signMessage', () => {
  const key = deriveSessionKey('test-session');

  it('produces a 64-char hex string', () => {
    const sig = signMessage({ role: 'user', content: 'hello' }, key);
    assert.strictEqual(typeof sig, 'string');
    assert.strictEqual(sig.length, 64);
    assert.ok(/^[0-9a-f]+$/.test(sig));
  });

  it('is deterministic (same input = same output)', () => {
    const msg = { role: 'user', content: 'test' };
    const sig1 = signMessage(msg, key);
    const sig2 = signMessage(msg, key);
    assert.strictEqual(sig1, sig2);
  });

  it('changes when content changes', () => {
    const sig1 = signMessage({ role: 'user', content: 'hello' }, key);
    const sig2 = signMessage({ role: 'user', content: 'world' }, key);
    assert.notStrictEqual(sig1, sig2);
  });

  it('excludes _sig field from signing', () => {
    const msg = { role: 'user', content: 'test' };
    const sig1 = signMessage(msg, key);
    const sig2 = signMessage({ ...msg, _sig: 'ignored' }, key);
    assert.strictEqual(sig1, sig2);
  });

  it('produces sorted canonical JSON (key order does not matter)', () => {
    const sig1 = signMessage({ content: 'test', role: 'user' }, key);
    const sig2 = signMessage({ role: 'user', content: 'test' }, key);
    assert.strictEqual(sig1, sig2);
  });
});

describe('verifyMessage', () => {
  const key = deriveSessionKey('test-session');

  it('returns true for valid signature', () => {
    const msg: Record<string, unknown> = { role: 'user', content: 'hello' };
    msg._sig = signMessage(msg, key);
    assert.strictEqual(verifyMessage(msg, key), true);
  });

  it('returns false when content is modified', () => {
    const msg: Record<string, unknown> = { role: 'user', content: 'hello' };
    msg._sig = signMessage(msg, key);
    msg.content = 'tampered';
    assert.strictEqual(verifyMessage(msg, key), false);
  });

  it('returns false when signature is modified', () => {
    const msg: Record<string, unknown> = { role: 'user', content: 'hello' };
    msg._sig = signMessage(msg, key);
    msg._sig = 'a'.repeat(64); // fake sig
    assert.strictEqual(verifyMessage(msg, key), false);
  });

  it('returns false when no signature present', () => {
    const msg = { role: 'user', content: 'hello' };
    assert.strictEqual(verifyMessage(msg, key), false);
  });

  it('returns false for different session key', () => {
    const otherKey = deriveSessionKey('other-session');
    const msg: Record<string, unknown> = { role: 'user', content: 'hello' };
    msg._sig = signMessage(msg, key);
    assert.strictEqual(verifyMessage(msg, otherKey), false);
  });
});

describe('verifyMessages', () => {
  const key = deriveSessionKey('test-session');

  it('correctly counts valid, tampered, and unsigned', () => {
    const messages: Array<Record<string, unknown>> = [
      // Valid signed
      (() => {
        const m: Record<string, unknown> = { role: 'user', content: 'hello' };
        m._sig = signMessage(m, key);
        return m;
      })(),
      // Tampered
      (() => {
        const m: Record<string, unknown> = { role: 'assistant', content: 'original' };
        m._sig = signMessage(m, key);
        m.content = 'tampered'; // modify after signing
        return m;
      })(),
      // Unsigned (backward compat)
      { role: 'user', content: 'old message' },
    ];

    const result = verifyMessages(messages, key);
    assert.strictEqual(result.valid, 1);
    assert.strictEqual(result.tampered, 1);
    assert.strictEqual(result.unsigned, 1);
    assert.deepStrictEqual(result.tamperedIndices, [1]);
  });

  it('returns all zeros for empty array', () => {
    const result = verifyMessages([], key);
    assert.strictEqual(result.valid, 0);
    assert.strictEqual(result.tampered, 0);
    assert.strictEqual(result.unsigned, 0);
    assert.deepStrictEqual(result.tamperedIndices, []);
  });

  it('all valid for properly signed messages', () => {
    const messages = [1, 2, 3].map(i => {
      const m: Record<string, unknown> = { role: 'user', content: `msg ${i}` };
      m._sig = signMessage(m, key);
      return m;
    });
    const result = verifyMessages(messages, key);
    assert.strictEqual(result.valid, 3);
    assert.strictEqual(result.tampered, 0);
    assert.strictEqual(result.unsigned, 0);
  });
});
