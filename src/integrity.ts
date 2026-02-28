/**
 * Session History Integrity for CodeBot v1.8.0
 *
 * HMAC-SHA256 signing/verification for session messages.
 * Key: SHA-256(sessionId + machineId) where machineId = hostname:username.
 *
 * This is tamper-DETECTION, not tamper-prevention. The key is deterministic
 * per session+machine so verification works without storing keys separately.
 *
 * Uses Node's built-in crypto module — zero runtime dependencies.
 */

import * as crypto from 'crypto';
import * as os from 'os';

// ── Key Derivation ──

/** Derive a per-session HMAC key. Deterministic for same session+machine. */
export function deriveSessionKey(sessionId: string): Buffer {
  const machineId = os.hostname() + ':' + getUserName();
  return crypto.createHash('sha256')
    .update(sessionId + machineId)
    .digest();
}

/** Get username safely. */
function getUserName(): string {
  try {
    return os.userInfo().username;
  } catch {
    return 'unknown';
  }
}

// ── Signing & Verification ──

/**
 * Compute HMAC-SHA256 signature for a message object.
 * Excludes the _sig field from the signing input.
 */
export function signMessage(
  message: Record<string, unknown>,
  key: Buffer,
): string {
  const payload = canonicalize(message);
  return crypto.createHmac('sha256', key)
    .update(payload)
    .digest('hex');
}

/**
 * Verify a message's HMAC signature.
 * Returns false if no signature present or if it doesn't match.
 */
export function verifyMessage(
  message: Record<string, unknown>,
  key: Buffer,
): boolean {
  const sig = message._sig as string | undefined;
  if (!sig) return false;

  const expected = signMessage(message, key);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(sig, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    return false; // Different lengths or invalid hex
  }
}

/**
 * Canonical JSON representation for signing.
 * Excludes _sig field. Keys are sorted for determinism.
 */
function canonicalize(obj: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    if (key === '_sig') continue;
    sorted[key] = obj[key];
  }
  return JSON.stringify(sorted);
}

// ── Batch Verification ──

export interface IntegrityResult {
  valid: number;
  tampered: number;
  unsigned: number;
  tamperedIndices: number[];
}

/**
 * Verify an array of signed messages.
 * Unsigned messages (pre-v1.8.0) are counted but not flagged as tampered.
 */
export function verifyMessages(
  messages: Array<Record<string, unknown>>,
  key: Buffer,
): IntegrityResult {
  let valid = 0;
  let tampered = 0;
  let unsigned = 0;
  const tamperedIndices: number[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg._sig) {
      unsigned++;
      continue;
    }
    if (verifyMessage(msg, key)) {
      valid++;
    } else {
      tampered++;
      tamperedIndices.push(i);
    }
  }

  return { valid, tampered, unsigned, tamperedIndices };
}
