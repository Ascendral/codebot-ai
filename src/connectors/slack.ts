/**
 * Slack Connector — Web API + Webhook fallback
 *
 * Auth: Bot Token (xoxb-*) or Webhook URL (https://hooks.slack.com/*)
 * If credential is a webhook URL, only post_message is supported.
 *
 * PR 10 (2026-04-26): migrated to the §8 connector contract.
 *   - Per-verb capability labels declared.
 *   - `post_message` ships preview (no network call, pure args
 *     inspection) and `redactArgsForAudit` (message → hash+length).
 *   - Idempotency declared as `{ kind: 'unsupported', reason: ... }`.
 *
 *     **Slack genuinely does not provide a client-supplied idempotency
 *     mechanism.** `chat.postMessage` has no `Idempotency-Key` header,
 *     no user-controllable `client_msg_id` parameter, and the
 *     server-assigned `ts` is allocated per-call. Webhook POSTs are
 *     the same shape — no dedup mechanism on either path. The
 *     connector does NOT implement a preflight dedup check.
 *
 *   - Reauth detection (BOTH paths):
 *       API mode (200 OK with `{ok:false, error:<code>}`):
 *         invalid_auth / not_authed / account_inactive /
 *         token_revoked / token_expired / no_permission /
 *         missing_scope → reauth
 *         ratelimited / channel_not_found / not_in_channel /
 *         is_archived / msg_too_long → NOT reauth
 *       Webhook mode (HTTP status):
 *         401 / 403 / 404 → reauth (URL is no longer usable)
 *         5xx → NOT reauth (server error, retry later)
 *   - `vaultKeyName: 'slack'` declared explicitly.
 *
 * No new actions added in this PR. Migration only.
 */

import { Connector, ConnectorAction, ConnectorPreview, ConnectorReauthError } from './base';
import { createHash } from 'crypto';

const BASE_URL = 'https://slack.com/api';
const TIMEOUT = 15_000;
const MAX_RESPONSE = 10_000;

function isWebhookUrl(cred: string): boolean {
  return cred.startsWith('https://hooks.slack.com/');
}

/**
 * Slack-API-mode auth-error classifier.
 *
 * Slack's Web API returns HTTP 200 with `{ok: false, error: '<code>'}`
 * for most failures including auth. So we look at the error CODE, not
 * the HTTP status. Pure function — exported for direct unit testing
 * without a fetch mock.
 *
 * Auth-class codes (token is no longer usable, user must reconnect):
 *   invalid_auth, not_authed, account_inactive, token_revoked,
 *   token_expired, no_permission, missing_scope
 *
 * Explicitly NOT reauth:
 *   ratelimited (throttling, retry later)
 *   channel_not_found (bad input)
 *   not_in_channel (permission, not auth — bot lacks membership)
 *   is_archived (channel state, not auth)
 *   msg_too_long (input validation)
 */
export function isSlackAuthError(body: { ok?: boolean; error?: string } | undefined): boolean {
  if (!body) return false;
  if (body.ok) return false;
  const err = String(body.error ?? '').toLowerCase();
  if (!err) return false;
  // Auth-class codes
  const authCodes = [
    'invalid_auth',
    'not_authed',
    'account_inactive',
    'token_revoked',
    'token_expired',
    'no_permission',
    'missing_scope',
  ];
  return authCodes.includes(err);
}

/**
 * Slack-webhook-mode auth-error classifier.
 *
 * Webhook POSTs return plain HTTP statuses (no Slack `ok` envelope).
 * 401/403/404 mean the URL is no longer usable: token revoked, hook
 * deleted, app uninstalled. The fix path is "replace the webhook URL"
 * which we model the same as "reconnect Slack credential."
 *
 * 5xx → server error, retry later (NOT reauth).
 * 2xx → success.
 * Other 4xx → not auth (bad payload, etc.).
 */
export function isSlackWebhookAuthError(httpStatus: number): boolean {
  return httpStatus === 401 || httpStatus === 403 || httpStatus === 404;
}

async function apiCall(
  method: string,
  credential: string,
  params?: Record<string, unknown>,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const res = await fetch(`${BASE_URL}/${method}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credential}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: params ? JSON.stringify(params) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json() as Record<string, unknown>;
    return { ok: !!data.ok, data };
  } catch (err: unknown) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Wraps `apiCall` and throws ConnectorReauthError when Slack's
 * `{ok:false, error:<auth-code>}` envelope indicates auth failure.
 * Non-auth failures pass through with `ok:false` for the caller to
 * format. Tests assert the error is structurally catchable BEFORE
 * any string formatting.
 */
async function apiCallOrReauth(
  method: string,
  credential: string,
  params?: Record<string, unknown>,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const result = await apiCall(method, credential, params);
  if (!result.ok && isSlackAuthError(result.data as { ok?: boolean; error?: string })) {
    const code = String(result.data.error ?? 'unknown');
    throw new ConnectorReauthError('slack', `Slack auth failed: ${code}`);
  }
  return result;
}

async function webhookPost(url: string, text: string, channel?: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const payload: Record<string, string> = { text };
    if (channel) payload.channel = channel;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    // Webhook auth check: 401/403/404 → token/hook is no longer
    // usable. Caller's catch block re-throws if it's a ReauthError.
    if (isSlackWebhookAuthError(res.status)) {
      throw new ConnectorReauthError(
        'slack',
        `Slack webhook auth failed (HTTP ${res.status}): URL no longer usable. Run: app connect slack`,
      );
    }
    if (res.ok) return 'Message posted via webhook.';
    return `Error: webhook returned ${res.status}`;
  } catch (err: unknown) {
    clearTimeout(timer);
    if (err instanceof ConnectorReauthError) throw err;
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function truncate(text: string): string {
  return text.length <= MAX_RESPONSE ? text : text.substring(0, MAX_RESPONSE) + '\n... (truncated)';
}

/** SHA-256 hash + length for audit redaction. Hex, first 16 chars. */
function hashAndLength(value: string): { hash: string; length: number } {
  return {
    hash: createHash('sha256').update(value).digest('hex').substring(0, 16),
    length: value.length,
  };
}

// ─── Idempotency declaration (per §8 connector contract) ──────────────────

const POST_MESSAGE_IDEMPOTENCY_REASON =
  'Slack chat.postMessage and webhook POSTs do not accept a client-supplied idempotency key. Each POST creates a new message with a new server-assigned ts (timestamp ID); there is no client_msg_id parameter and no Idempotency-Key header. The connector does not implement a preflight dedup check.';

// ─── Redaction helper (mutating verb only) ────────────────────────────────

/**
 * Redact `message` to hash+length. Keep `channel` and `thread_ts`
 * visible — auditors need them and neither carries message-sized PII.
 */
function redactPostMessageArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };
  if (typeof args.message === 'string') {
    const d = hashAndLength(args.message);
    out.message = `<redacted sha256:${d.hash} len:${d.length}>`;
  }
  return out;
}

// ─── Preview function (pure, no network) ──────────────────────────────────

/**
 * Preview for post_message. Pure — no network call. The credential
 * parameter is ignored; preview is "what would happen" computed
 * entirely from the args.
 */
function previewPostMessage(args: Record<string, unknown>): ConnectorPreview {
  const channel = String(args.channel ?? '');
  const messageStr = String(args.message ?? '');
  const threadTs = typeof args.thread_ts === 'string' && args.thread_ts.length > 0 ? args.thread_ts : '';
  const messageDigest = hashAndLength(messageStr);

  const lines = [
    `Would post to Slack:`,
    `  Channel:   ${channel}`,
    `  Thread:    ${threadTs || '(new thread)'}`,
    `  Message:   ${messageDigest.length} chars (sha256:${messageDigest.hash})`,
  ];

  return {
    summary: lines.join('\n'),
    details: {
      channel,
      threadTs: threadTs || undefined,
      messageLength: messageDigest.length,
      messageHash: messageDigest.hash,
    },
  };
}

// ─── Action definitions ───────────────────────────────────────────────────

const postMessage: ConnectorAction = {
  name: 'post_message',
  description: 'Post a message to a Slack channel',
  parameters: {
    type: 'object',
    properties: {
      channel: { type: 'string', description: 'Channel name (e.g., #general) or ID' },
      message: { type: 'string', description: 'Message text (supports Slack mrkdwn)' },
      thread_ts: { type: 'string', description: 'Thread timestamp to reply in a thread' },
    },
    required: ['channel', 'message'],
  },
  capabilities: ['account-access', 'net-fetch', 'send-on-behalf'],
  idempotency: {
    kind: 'unsupported',
    reason: POST_MESSAGE_IDEMPOTENCY_REASON,
  },
  preview: async (args, _credential): Promise<ConnectorPreview> => previewPostMessage(args),
  redactArgsForAudit: redactPostMessageArgs,
  execute: async (args, cred) => {
    const channel = args.channel as string;
    const message = args.message as string;
    if (!channel || !message) return 'Error: channel and message are required';

    // Webhook mode
    if (isWebhookUrl(cred)) {
      try {
        return await webhookPost(cred, message, channel);
      } catch (err: unknown) {
        // ConnectorReauthError propagates to AppConnectorTool which
        // catches via isConnectorReauthError. webhookPost returns
        // plain strings for non-reauth errors.
        if (err instanceof ConnectorReauthError) throw err;
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // API mode
    try {
      const params: Record<string, unknown> = {
        channel: channel.replace(/^#/, ''),
        text: message,
      };
      if (args.thread_ts) params.thread_ts = args.thread_ts;

      const { ok, data } = await apiCallOrReauth('chat.postMessage', cred, params);
      if (!ok) return `Error: Slack API: ${data.error || 'unknown error'}`;
      return `Message posted to ${channel}.`;
    } catch (err: unknown) {
      if (err instanceof ConnectorReauthError) throw err;
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

const listChannels: ConnectorAction = {
  name: 'list_channels',
  description: 'List public channels in the workspace',
  parameters: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Number of channels to return (default 20, max 100)' },
    },
  },
  capabilities: ['read-only', 'account-access', 'net-fetch'],
  // Read-only — no preview / idempotency / redaction required.
  execute: async (args, cred) => {
    if (isWebhookUrl(cred)) return 'Error: list_channels requires a Bot Token, not a webhook URL';
    try {
      const limit = Math.min((args.limit as number) || 20, 100);
      const { ok, data } = await apiCallOrReauth('conversations.list', cred, {
        types: 'public_channel',
        limit,
        exclude_archived: true,
      });
      if (!ok) return `Error: Slack API: ${data.error || 'unknown error'}`;
      const channels = (data.channels as Array<{ name: string; topic: { value: string }; num_members: number }>) || [];
      if (!channels.length) return 'No channels found.';
      const lines = channels.map(c =>
        `  #${c.name} (${c.num_members} members)${c.topic?.value ? ` — ${c.topic.value.substring(0, 60)}` : ''}`
      );
      return truncate(`Channels (${channels.length}):\n${lines.join('\n')}`);
    } catch (err: unknown) {
      if (err instanceof ConnectorReauthError) throw err;
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

const searchMessages: ConnectorAction = {
  name: 'search_messages',
  description: 'Search messages in the workspace',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      count: { type: 'number', description: 'Results to return (default 10, max 50)' },
    },
    required: ['query'],
  },
  capabilities: ['read-only', 'account-access', 'net-fetch'],
  // Read-only — no preview / idempotency / redaction required.
  execute: async (args, cred) => {
    if (isWebhookUrl(cred)) return 'Error: search_messages requires a Bot Token, not a webhook URL';
    const query = args.query as string;
    if (!query) return 'Error: query is required';
    try {
      const count = Math.min((args.count as number) || 10, 50);
      const { ok, data } = await apiCallOrReauth('search.messages', cred, { query, count });
      if (!ok) return `Error: Slack API: ${data.error || 'unknown error'}`;
      const messages = (data.messages as { matches: Array<{ text: string; username: string; channel: { name: string }; ts: string }> })?.matches || [];
      if (!messages.length) return `No messages found for "${query}".`;
      const lines = messages.map(m =>
        `  [#${m.channel?.name || '?'}] ${m.username || '?'}: ${(m.text || '').substring(0, 100)}`
      );
      return truncate(`Search results (${messages.length}):\n${lines.join('\n')}`);
    } catch (err: unknown) {
      if (err instanceof ConnectorReauthError) throw err;
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export class SlackConnector implements Connector {
  name = 'slack';
  displayName = 'Slack';
  description = 'Post messages, list channels, and search in Slack workspaces.';
  authType: Connector['authType'] = 'api_key';
  envKey = 'SLACK_TOKEN';
  vaultKeyName = 'slack';

  actions: ConnectorAction[] = [postMessage, listChannels, searchMessages];

  async validate(credential: string): Promise<boolean> {
    if (isWebhookUrl(credential)) {
      // Can't validate webhooks without sending a message
      try { new URL(credential); return true; } catch { return false; }
    }
    try {
      const { ok } = await apiCall('auth.test', credential);
      return ok;
    } catch {
      return false;
    }
  }
}
