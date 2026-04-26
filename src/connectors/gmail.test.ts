import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { GmailConnector, isGmailAuthError } from './gmail';
import { assertContractClean, validateConnectorContract } from './connector-contract';
import { ConnectorReauthError, isConnectorReauthError } from './base';

/**
 * PR 8 — Gmail under the §8 connector contract.
 *
 * Pins:
 *   - GmailConnector passes assertContractClean (zero violations).
 *   - Per-verb capabilities match the agreed table.
 *   - send_email and create_draft preview pure-from-args (no network),
 *     return the documented shape.
 *   - send_email and create_draft redaction hashes body, keeps to/cc/subject.
 *   - Idempotency declared as `unsupported` for both mutating verbs
 *     with a non-empty reason that names Gmail and "not idempotent."
 *   - vaultKeyName declared.
 *   - isGmailAuthError classifier maps 401/403 + auth keywords to true,
 *     other errors to false. Exercised directly without a fetch mock.
 */

describe('GmailConnector — §8 contract compliance', () => {
  it('passes assertContractClean with zero violations', () => {
    assert.doesNotThrow(() => assertContractClean(new GmailConnector()));
  });

  it('reports zero contract violations from validateConnectorContract', () => {
    assert.deepStrictEqual(validateConnectorContract(new GmailConnector()), []);
  });

  it('exposes 5 actions (PR 8 migration only — no new actions added)', () => {
    const gm = new GmailConnector();
    const names = gm.actions.map((a) => a.name).sort();
    assert.deepStrictEqual(names, [
      'create_draft', 'list_emails', 'read_email', 'search_emails', 'send_email',
    ]);
  });

  it('declares vaultKeyName explicitly', () => {
    const gm = new GmailConnector();
    assert.strictEqual(gm.vaultKeyName, 'gmail');
  });
});

describe('GmailConnector — per-verb capability labels', () => {
  function getAction(name: string) {
    const gm = new GmailConnector();
    const a = gm.actions.find((x) => x.name === name);
    if (!a) throw new Error(`action ${name} not found`);
    return a;
  }

  it('list_emails: read-only + account-access + net-fetch', () => {
    assert.deepStrictEqual(
      getAction('list_emails').capabilities?.slice().sort(),
      ['account-access', 'net-fetch', 'read-only'],
    );
  });

  it('read_email: read-only + account-access + net-fetch', () => {
    assert.deepStrictEqual(
      getAction('read_email').capabilities?.slice().sort(),
      ['account-access', 'net-fetch', 'read-only'],
    );
  });

  it('search_emails: read-only + account-access + net-fetch', () => {
    assert.deepStrictEqual(
      getAction('search_emails').capabilities?.slice().sort(),
      ['account-access', 'net-fetch', 'read-only'],
    );
  });

  it('send_email: account-access + net-fetch + send-on-behalf', () => {
    assert.deepStrictEqual(
      getAction('send_email').capabilities?.slice().sort(),
      ['account-access', 'net-fetch', 'send-on-behalf'],
    );
  });

  it('create_draft: account-access + net-fetch + send-on-behalf', () => {
    // create_draft is labeled send-on-behalf (not just account-access) because
    // it creates remote account state under the user's identity. Preview +
    // redaction therefore apply per §8.
    assert.deepStrictEqual(
      getAction('create_draft').capabilities?.slice().sort(),
      ['account-access', 'net-fetch', 'send-on-behalf'],
    );
  });

  it('read-only verbs do NOT declare preview/idempotency/redact', () => {
    for (const name of ['list_emails', 'read_email', 'search_emails']) {
      const a = getAction(name);
      assert.strictEqual(a.preview, undefined, `${name}.preview must be undefined for read-only verb`);
      assert.strictEqual(a.idempotency, undefined, `${name}.idempotency must be undefined for read-only verb`);
      assert.strictEqual(a.redactArgsForAudit, undefined, `${name}.redactArgsForAudit must be undefined for read-only verb`);
    }
  });
});

describe('GmailConnector — send_email preview', () => {
  function getSend() {
    const gm = new GmailConnector();
    return gm.actions.find((a) => a.name === 'send_email')!;
  }

  it('returns the documented {summary, details} shape', async () => {
    const result = await getSend().preview!(
      { to: 'alice@example.com', subject: 'Hi', body: 'top secret stuff', cc: 'bob@example.com' },
      'fake-credential-not-used',
    );
    assert.ok(typeof result.summary === 'string' && result.summary.length > 0);
    assert.ok(typeof result.details === 'object');
  });

  it('summary names recipient + subject + body length+hash', async () => {
    const result = await getSend().preview!(
      { to: 'alice@example.com', subject: 'Subject Line', body: 'hello world' },
      'fake-credential',
    );
    assert.match(result.summary, /alice@example\.com/);
    assert.match(result.summary, /Subject Line/);
    assert.match(result.summary, /11 chars/);             // 'hello world' is 11
    assert.match(result.summary, /sha256:[a-f0-9]+/);
  });

  it('summary includes Cc when present, omits when absent', async () => {
    const withCc = await getSend().preview!(
      { to: 'a@x', subject: 's', body: 'b', cc: 'c@x' },
      'creds',
    );
    assert.match(withCc.summary, /Cc:\s+c@x/);

    const withoutCc = await getSend().preview!(
      { to: 'a@x', subject: 's', body: 'b' },
      'creds',
    );
    assert.doesNotMatch(withoutCc.summary, /Cc:/);
  });

  it('summary does NOT mention attachments (verb does not support them today)', async () => {
    // Per Alex's PR 8 review: don't render fields the verb doesn't support.
    const result = await getSend().preview!(
      { to: 'a@x', subject: 's', body: 'b' },
      'creds',
    );
    assert.doesNotMatch(result.summary, /attachment/i);
  });

  it('details object exposes structured fields', async () => {
    const result = await getSend().preview!(
      { to: 'alice@example.com', subject: 'Subject', body: 'hello' },
      'creds',
    );
    const d = result.details as Record<string, unknown>;
    assert.strictEqual(d.to, 'alice@example.com');
    assert.strictEqual(d.subject, 'Subject');
    assert.strictEqual(d.bodyLength, 5);
    assert.match(String(d.bodyHash), /^[a-f0-9]{16}$/);
  });

  it('preview makes NO network call (pure args inspection)', async () => {
    // We exercise this by passing a token that would 401 if used. The
    // preview function doesn't call gmailFetch, so the call must not
    // throw and must not return any HTTP error indicators.
    const result = await getSend().preview!(
      { to: 'a@x', subject: 's', body: 'b' },
      'definitely-not-a-real-token',
    );
    assert.match(result.summary, /Would send/);
    assert.doesNotMatch(result.summary, /[Ee]rror/);
  });
});

describe('GmailConnector — create_draft preview', () => {
  function getDraft() {
    const gm = new GmailConnector();
    return gm.actions.find((a) => a.name === 'create_draft')!;
  }

  it('summary makes clear this is a draft, NOT a send', async () => {
    const result = await getDraft().preview!(
      { to: 'a@x', subject: 's', body: 'hello' },
      'creds',
    );
    assert.match(result.summary, /draft/i);
    assert.match(result.summary, /not sent/i);
  });

  it('summary names recipient + subject + body length+hash', async () => {
    const result = await getDraft().preview!(
      { to: 'recipient@example.com', subject: 'Topic', body: 'message body' },
      'creds',
    );
    assert.match(result.summary, /recipient@example\.com/);
    assert.match(result.summary, /Topic/);
    assert.match(result.summary, /12 chars/);
    assert.match(result.summary, /sha256:[a-f0-9]+/);
  });

  it('preview makes NO network call', async () => {
    const result = await getDraft().preview!(
      { to: 'a@x', subject: 's', body: 'b' },
      'definitely-not-a-real-token',
    );
    assert.doesNotMatch(result.summary, /[Ee]rror/);
  });
});

describe('GmailConnector — redactArgsForAudit (mutating verbs only)', () => {
  it('send_email: body redacted to hash+length; to/cc/subject preserved', () => {
    const gm = new GmailConnector();
    const send = gm.actions.find((a) => a.name === 'send_email')!;
    const redacted = send.redactArgsForAudit!({
      to: 'alice@example.com',
      cc: 'bob@example.com',
      subject: 'Subject Line',
      body: 'top secret message body',
    });
    assert.strictEqual(redacted.to, 'alice@example.com', 'recipient stays in audit');
    assert.strictEqual(redacted.cc, 'bob@example.com', 'cc stays in audit');
    assert.strictEqual(redacted.subject, 'Subject Line', 'subject stays in audit');
    assert.match(String(redacted.body), /^<redacted sha256:[a-f0-9]+ len:\d+>$/,
      'body must be redacted to hash+length');
  });

  it('create_draft: body redacted; to/subject preserved', () => {
    const gm = new GmailConnector();
    const draft = gm.actions.find((a) => a.name === 'create_draft')!;
    const redacted = draft.redactArgsForAudit!({
      to: 'recipient@example.com',
      subject: 'Topic',
      body: 'private content here',
    });
    assert.strictEqual(redacted.to, 'recipient@example.com');
    assert.strictEqual(redacted.subject, 'Topic');
    assert.match(String(redacted.body), /^<redacted sha256:[a-f0-9]+ len:20>$/);
  });

  it('redaction is deterministic (same body → same hash)', () => {
    const gm = new GmailConnector();
    const send = gm.actions.find((a) => a.name === 'send_email')!;
    const a = send.redactArgsForAudit!({ to: 'x', subject: 's', body: 'same content' });
    const b = send.redactArgsForAudit!({ to: 'y', subject: 't', body: 'same content' });
    assert.strictEqual(a.body, b.body, 'identical body must produce identical hash');
  });

  it('redaction handles missing body gracefully (no body field, no crash)', () => {
    const gm = new GmailConnector();
    const send = gm.actions.find((a) => a.name === 'send_email')!;
    const redacted = send.redactArgsForAudit!({ to: 'x', subject: 's' });
    // body absent in input → absent in output (no fake hash injected)
    assert.strictEqual(redacted.body, undefined);
  });
});

describe('GmailConnector — idempotency declarations (unsupported arm)', () => {
  it('send_email: kind=unsupported with non-empty reason citing Gmail + not-idempotent', () => {
    const gm = new GmailConnector();
    const send = gm.actions.find((a) => a.name === 'send_email')!;
    assert.ok(send.idempotency);
    assert.strictEqual(send.idempotency!.kind, 'unsupported');
    if (send.idempotency!.kind === 'unsupported') {
      const reason = send.idempotency!.reason;
      assert.ok(reason.length > 0, 'reason must be non-empty');
      assert.match(reason, /Gmail/i, 'reason must name Gmail');
      assert.match(reason, /not idempotent/i, 'reason must explicitly say "not idempotent"');
    }
  });

  it('create_draft: kind=unsupported with non-empty reason', () => {
    const gm = new GmailConnector();
    const draft = gm.actions.find((a) => a.name === 'create_draft')!;
    assert.ok(draft.idempotency);
    assert.strictEqual(draft.idempotency!.kind, 'unsupported');
    if (draft.idempotency!.kind === 'unsupported') {
      assert.ok(draft.idempotency!.reason.length > 0);
      assert.match(draft.idempotency!.reason, /Gmail/i);
    }
  });
});

describe('GmailConnector — auth-error classifier (no fetch mock)', () => {
  // Direct unit tests on the pure classifier function. No network mock
  // layer introduced — that's a separate architectural decision per
  // Alex's PR 8 review.

  it('401 → reauth', () => {
    assert.strictEqual(isGmailAuthError(401, {}), true);
    assert.strictEqual(isGmailAuthError(401, { error: { message: 'invalid token' } }), true);
  });

  it('403 → reauth', () => {
    assert.strictEqual(isGmailAuthError(403, {}), true);
  });

  it('error.status === "UNAUTHENTICATED" → reauth (any HTTP status)', () => {
    assert.strictEqual(isGmailAuthError(400, { error: { status: 'UNAUTHENTICATED' } }), true);
  });

  it('error.status === "PERMISSION_DENIED" → reauth', () => {
    assert.strictEqual(isGmailAuthError(400, { error: { status: 'PERMISSION_DENIED' } }), true);
  });

  it('error.message keywords → reauth', () => {
    for (const msg of ['Invalid Credentials', 'invalid_grant', 'Token expired', 'Access denied']) {
      assert.strictEqual(
        isGmailAuthError(400, { error: { message: msg } }),
        true,
        `expected "${msg}" to classify as reauth`,
      );
    }
  });

  it('200 OK → not reauth', () => {
    assert.strictEqual(isGmailAuthError(200, {}), false);
  });

  it('500 server error → not reauth (different problem class)', () => {
    assert.strictEqual(isGmailAuthError(500, { error: { message: 'internal error' } }), false);
  });

  it('400 with non-auth message → not reauth', () => {
    assert.strictEqual(isGmailAuthError(400, { error: { message: 'invalid recipient' } }), false);
  });

  it('handles missing/malformed data without crashing', () => {
    assert.strictEqual(isGmailAuthError(200, undefined), false);
    assert.strictEqual(isGmailAuthError(401, undefined), true);
    assert.strictEqual(isGmailAuthError(200, { error: null as unknown as Record<string, unknown> }), false);
  });
});

describe('GmailConnector — ConnectorReauthError contract', () => {
  it('ConnectorReauthError instances pass isConnectorReauthError', () => {
    const e = new ConnectorReauthError('gmail', 'token expired');
    assert.ok(isConnectorReauthError(e));
    assert.strictEqual(e.kind, 'reauth-required');
    assert.strictEqual(e.service, 'gmail');
  });
});

describe('GmailConnector — validate (input validation only, no real API call)', () => {
  it('returns false for empty token', async () => {
    const gm = new GmailConnector();
    const valid = await gm.validate('');
    assert.strictEqual(valid, false);
  });

  it('returns false for credential JSON with no token', async () => {
    const gm = new GmailConnector();
    const valid = await gm.validate(JSON.stringify({ email: 'x@y.com' }));
    assert.strictEqual(valid, false);
  });
});
