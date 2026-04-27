import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { SlackConnector, isSlackAuthError, isSlackWebhookAuthError } from './slack';
import { assertContractClean, validateConnectorContract } from './connector-contract';
import { ConnectorReauthError, isConnectorReauthError } from './base';

/**
 * SlackConnector tests — pre-PR-10: validates host injection blocking,
 * input validation, action routing, metadata, and error messages.
 *
 * PR 10 (2026-04-26) extensions:
 *   - assertContractClean passes (zero §8 violations)
 *   - Per-verb capabilities match the agreed table
 *   - Read verbs omit preview/idempotency/redact
 *   - post_message preview shape (pure-from-args, no network)
 *   - redactArgsForAudit hashes message, keeps channel/thread_ts
 *   - Idempotency declaration: kind='unsupported' with reason naming
 *     Slack + chat.postMessage + "no client_msg_id" + "no Idempotency-Key"
 *   - isSlackAuthError classifier — auth-class codes vs the explicit
 *     non-auth ones (rate limit / channel state / input validation)
 *   - isSlackWebhookAuthError classifier — 401/403/404 → reauth;
 *     5xx and 2xx → not reauth
 *   - ConnectorReauthError catchability via isConnectorReauthError
 *
 * Tests cover the classifiers directly with no fetch mock.
 */

describe('SlackConnector', () => {
  it('has correct metadata', () => {
    const slack = new SlackConnector();
    assert.strictEqual(slack.name, 'slack');
    assert.strictEqual(slack.displayName, 'Slack');
    assert.strictEqual(slack.envKey, 'SLACK_TOKEN');
    assert.strictEqual(slack.authType, 'api_key');
  });

  it('has all expected actions', () => {
    const slack = new SlackConnector();
    const names = slack.actions.map(a => a.name);
    assert.ok(names.includes('post_message'));
    assert.ok(names.includes('list_channels'));
    assert.ok(names.includes('search_messages'));
    assert.strictEqual(slack.actions.length, 3);
  });

  it('post_message requires channel and message', async () => {
    const slack = new SlackConnector();
    const action = slack.actions.find(a => a.name === 'post_message')!;
    const result = await action.execute({ channel: '', message: '' }, 'xoxb-fake');
    assert.ok(result.includes('Error:'));
  });

  it('validates webhook URLs as valid format', async () => {
    const slack = new SlackConnector();
    // Webhook URLs are validated by URL format only
    const valid = await slack.validate('https://hooks.slack.com/services/T00/B00/xxx');
    assert.ok(valid);
  });
});

// ─── PR 10 — §8 contract migration ────────────────────────────────────────

describe('SlackConnector — §8 contract compliance (PR 10)', () => {
  it('passes assertContractClean with zero violations', () => {
    assert.doesNotThrow(() => assertContractClean(new SlackConnector()));
  });

  it('reports zero contract violations from validateConnectorContract', () => {
    assert.deepStrictEqual(validateConnectorContract(new SlackConnector()), []);
  });

  it('exposes 3 actions (PR 10 migration only — no new actions added)', () => {
    const slack = new SlackConnector();
    const names = slack.actions.map((a) => a.name).sort();
    assert.deepStrictEqual(names, ['list_channels', 'post_message', 'search_messages']);
  });

  it('declares vaultKeyName explicitly', () => {
    const slack = new SlackConnector();
    assert.strictEqual(slack.vaultKeyName, 'slack');
  });
});

describe('SlackConnector — per-verb capability labels', () => {
  function getAction(name: string) {
    const slack = new SlackConnector();
    const a = slack.actions.find((x) => x.name === name);
    if (!a) throw new Error(`action ${name} not found`);
    return a;
  }

  it('list_channels: read-only + account-access + net-fetch', () => {
    assert.deepStrictEqual(
      getAction('list_channels').capabilities?.slice().sort(),
      ['account-access', 'net-fetch', 'read-only'],
    );
  });

  it('search_messages: read-only + account-access + net-fetch', () => {
    assert.deepStrictEqual(
      getAction('search_messages').capabilities?.slice().sort(),
      ['account-access', 'net-fetch', 'read-only'],
    );
  });

  it('post_message: account-access + net-fetch + send-on-behalf', () => {
    assert.deepStrictEqual(
      getAction('post_message').capabilities?.slice().sort(),
      ['account-access', 'net-fetch', 'send-on-behalf'],
    );
  });

  it('read-only verbs omit preview/idempotency/redact', () => {
    for (const name of ['list_channels', 'search_messages']) {
      const a = getAction(name);
      assert.strictEqual(a.preview, undefined, `${name}.preview must be undefined for read-only verb`);
      assert.strictEqual(a.idempotency, undefined, `${name}.idempotency must be undefined for read-only verb`);
      assert.strictEqual(a.redactArgsForAudit, undefined, `${name}.redactArgsForAudit must be undefined for read-only verb`);
    }
  });
});

describe('SlackConnector — post_message preview', () => {
  function getPost() {
    const slack = new SlackConnector();
    return slack.actions.find((a) => a.name === 'post_message')!;
  }

  it('returns the documented {summary, details} shape', async () => {
    const result = await getPost().preview!(
      { channel: '#general', message: 'hello team' },
      'fake-credential-not-used',
    );
    assert.ok(typeof result.summary === 'string' && result.summary.length > 0);
    assert.ok(typeof result.details === 'object');
  });

  it('summary names channel + message length+hash', async () => {
    const result = await getPost().preview!(
      { channel: '#general', message: 'hello world' },
      'fake-cred',
    );
    assert.match(result.summary, /#general/);
    assert.match(result.summary, /11 chars/);   // 'hello world'
    assert.match(result.summary, /sha256:[a-f0-9]+/);
  });

  it('summary shows "(new thread)" for missing thread_ts', async () => {
    const result = await getPost().preview!(
      { channel: '#general', message: 'hi' },
      'fake-cred',
    );
    assert.match(result.summary, /Thread:\s+\(new thread\)/);
  });

  it('summary shows existing thread_ts when present', async () => {
    const result = await getPost().preview!(
      { channel: '#general', message: 'replying', thread_ts: '1234567890.123456' },
      'fake-cred',
    );
    assert.match(result.summary, /Thread:\s+1234567890\.123456/);
    assert.doesNotMatch(result.summary, /\(new thread\)/);
  });

  it('details object exposes structured fields', async () => {
    const result = await getPost().preview!(
      { channel: '#alerts', message: 'hello' },
      'fake-cred',
    );
    const d = result.details as Record<string, unknown>;
    assert.strictEqual(d.channel, '#alerts');
    assert.strictEqual(d.messageLength, 5);
    assert.match(String(d.messageHash), /^[a-f0-9]{16}$/);
  });

  it('preview makes NO network call (pure args inspection)', async () => {
    const result = await getPost().preview!(
      { channel: '#general', message: 'b' },
      'definitely-not-a-real-token',
    );
    assert.match(result.summary, /Would post to Slack/);
    assert.doesNotMatch(result.summary, /[Ee]rror/);
  });
});

describe('SlackConnector — redactArgsForAudit (mutating verb only)', () => {
  it('post_message: message redacted to hash+length; channel + thread_ts preserved', () => {
    const slack = new SlackConnector();
    const action = slack.actions.find((a) => a.name === 'post_message')!;
    const redacted = action.redactArgsForAudit!({
      channel: '#general',
      message: 'sensitive announcement details here',
      thread_ts: '1234567890.123456',
    });
    assert.strictEqual(redacted.channel, '#general', 'channel stays in audit');
    assert.strictEqual(redacted.thread_ts, '1234567890.123456', 'thread_ts stays in audit');
    assert.match(String(redacted.message), /^<redacted sha256:[a-f0-9]+ len:\d+>$/,
      'message must be redacted to hash+length');
  });

  it('redaction is deterministic (same message → same hash)', () => {
    const slack = new SlackConnector();
    const action = slack.actions.find((a) => a.name === 'post_message')!;
    const a = action.redactArgsForAudit!({ channel: 'a', message: 'same content' });
    const b = action.redactArgsForAudit!({ channel: 'b', message: 'same content' });
    assert.strictEqual(a.message, b.message, 'identical message must produce identical hash');
  });

  it('redaction handles missing message (no crash, no fake hash)', () => {
    const slack = new SlackConnector();
    const action = slack.actions.find((a) => a.name === 'post_message')!;
    const redacted = action.redactArgsForAudit!({ channel: '#general' });
    assert.strictEqual(redacted.message, undefined, 'missing message must NOT get a fabricated hash');
  });
});

describe('SlackConnector — idempotency declaration (unsupported arm)', () => {
  it('post_message: kind=unsupported with reason naming Slack + chat.postMessage + no client-supplied key', () => {
    const slack = new SlackConnector();
    const action = slack.actions.find((a) => a.name === 'post_message')!;
    assert.ok(action.idempotency);
    assert.strictEqual(action.idempotency!.kind, 'unsupported');
    if (action.idempotency!.kind === 'unsupported') {
      const reason = action.idempotency!.reason;
      assert.ok(reason.length > 0, 'reason must be non-empty');
      assert.match(reason, /Slack/i);
      assert.match(reason, /chat\.postMessage/i);
      assert.match(reason, /client[_-]?msg[_-]?id/i, 'reason must explicitly note no client_msg_id');
      assert.match(reason, /Idempotency[_-]?Key|client-supplied idempotency/i,
        'reason must explicitly note no Idempotency-Key / client-supplied idempotency');
    }
  });
});

describe('SlackConnector — API-mode auth-error classifier (no fetch mock)', () => {
  // Pure unit tests on isSlackAuthError. Slack returns HTTP 200 with
  // {ok:false, error:'<code>'} for most failures, so the classifier
  // looks at the error CODE.

  it('invalid_auth → reauth', () => {
    assert.strictEqual(isSlackAuthError({ ok: false, error: 'invalid_auth' }), true);
  });

  it('not_authed → reauth', () => {
    assert.strictEqual(isSlackAuthError({ ok: false, error: 'not_authed' }), true);
  });

  it('account_inactive → reauth', () => {
    assert.strictEqual(isSlackAuthError({ ok: false, error: 'account_inactive' }), true);
  });

  it('token_revoked → reauth', () => {
    assert.strictEqual(isSlackAuthError({ ok: false, error: 'token_revoked' }), true);
  });

  it('token_expired → reauth', () => {
    assert.strictEqual(isSlackAuthError({ ok: false, error: 'token_expired' }), true);
  });

  it('no_permission → reauth', () => {
    assert.strictEqual(isSlackAuthError({ ok: false, error: 'no_permission' }), true);
  });

  it('missing_scope → reauth', () => {
    assert.strictEqual(isSlackAuthError({ ok: false, error: 'missing_scope' }), true);
  });

  it('ratelimited → NOT reauth (user just waits)', () => {
    // Critical: must not prompt reconnect for rate limiting.
    assert.strictEqual(isSlackAuthError({ ok: false, error: 'ratelimited' }), false);
  });

  it('channel_not_found → NOT reauth (bad input, not auth)', () => {
    assert.strictEqual(isSlackAuthError({ ok: false, error: 'channel_not_found' }), false);
  });

  it('not_in_channel → NOT reauth (permission, not auth — bot lacks membership)', () => {
    assert.strictEqual(isSlackAuthError({ ok: false, error: 'not_in_channel' }), false);
  });

  it('is_archived → NOT reauth (channel state)', () => {
    assert.strictEqual(isSlackAuthError({ ok: false, error: 'is_archived' }), false);
  });

  it('msg_too_long → NOT reauth (input validation)', () => {
    assert.strictEqual(isSlackAuthError({ ok: false, error: 'msg_too_long' }), false);
  });

  it('ok:true → not reauth', () => {
    assert.strictEqual(isSlackAuthError({ ok: true }), false);
  });

  it('handles missing/malformed body without crashing', () => {
    assert.strictEqual(isSlackAuthError(undefined), false);
    assert.strictEqual(isSlackAuthError({}), false);
    assert.strictEqual(isSlackAuthError({ ok: false }), false);    // no error code
    assert.strictEqual(isSlackAuthError({ ok: false, error: '' }), false);
  });

  it('unknown error code → NOT reauth (don\'t fake-prompt for unknown failures)', () => {
    assert.strictEqual(isSlackAuthError({ ok: false, error: 'something_we_have_never_heard_of' }), false);
  });
});

describe('SlackConnector — webhook-mode auth classifier (no fetch mock)', () => {
  // Webhook POSTs return plain HTTP statuses. 401/403/404 mean the
  // URL is no longer usable; user needs to replace the webhook URL
  // (modeled the same as "reconnect Slack credential").

  it('401 → reauth (token revoked)', () => {
    assert.strictEqual(isSlackWebhookAuthError(401), true);
  });

  it('403 → reauth (forbidden)', () => {
    assert.strictEqual(isSlackWebhookAuthError(403), true);
  });

  it('404 → reauth (hook deleted / app uninstalled)', () => {
    assert.strictEqual(isSlackWebhookAuthError(404), true);
  });

  it('200 → NOT reauth (success)', () => {
    assert.strictEqual(isSlackWebhookAuthError(200), false);
  });

  it('500 → NOT reauth (server error, retry later)', () => {
    assert.strictEqual(isSlackWebhookAuthError(500), false);
  });

  it('502 / 503 → NOT reauth (transient server)', () => {
    assert.strictEqual(isSlackWebhookAuthError(502), false);
    assert.strictEqual(isSlackWebhookAuthError(503), false);
  });

  it('400 → NOT reauth (bad payload, not auth)', () => {
    assert.strictEqual(isSlackWebhookAuthError(400), false);
  });

  it('429 → NOT reauth (rate limit, retry later)', () => {
    assert.strictEqual(isSlackWebhookAuthError(429), false);
  });
});

describe('SlackConnector — ConnectorReauthError contract', () => {
  it('ConnectorReauthError instances pass isConnectorReauthError', () => {
    const e = new ConnectorReauthError('slack', 'token revoked');
    assert.ok(isConnectorReauthError(e));
    assert.strictEqual(e.kind, 'reauth-required');
    assert.strictEqual(e.service, 'slack');
  });
});
