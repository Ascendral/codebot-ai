/**
 * Gmail Connector — Send, read, search, and draft emails via Gmail API.
 *
 * Auth: Gmail App Password (GMAIL_APP_PASSWORD) + GMAIL_ADDRESS env vars.
 * Uses SMTP for sending, IMAP-style REST calls for reading.
 * Falls back to nodemailer-free raw SMTP via net sockets.
 *
 * For simplicity, this uses the Gmail API with an app password or OAuth token.
 * Set GMAIL_ADDRESS and GMAIL_APP_PASSWORD (or a Gmail API OAuth token).
 *
 * PR 8 (2026-04-25): migrated to the §8 connector contract.
 *   - Per-verb capability labels declared.
 *   - `send_email` and `create_draft` ship `preview` (no network call,
 *     pure args inspection) and `redactArgsForAudit` (body → hash+length).
 *   - Idempotency declared: read verbs omit; send/draft use
 *     `{ kind: 'unsupported', reason: ... }` — Gmail's
 *     `users.messages.send` and `users.drafts.create` do NOT support
 *     client-supplied dedup keys; each POST creates a new
 *     message/draft regardless of body content. RFC 2822 Message-ID
 *     headers are accepted but not used for server-side dedup.
 *   - Reauth detection: 401/403 from `gmailFetch` throws
 *     `ConnectorReauthError('gmail', message)` instead of returning
 *     a string. Caught by AppConnectorTool via `isConnectorReauthError`.
 *   - `vaultKeyName: 'gmail'` declared explicitly.
 *
 * No new actions added in this PR. `delete_message` and similar
 * destructive verbs deserve their own design + PR.
 */

import { Connector, ConnectorAction, ConnectorPreview, ConnectorReauthError } from './base';
import { createHash } from 'crypto';

const TIMEOUT = 20_000;
const MAX_RESPONSE = 10_000;
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

function truncate(text: string): string {
  return text.length <= MAX_RESPONSE ? text : text.substring(0, MAX_RESPONSE) + '\n... (truncated)';
}

function parseCredential(cred: string): { email: string; token: string } {
  // Credential can be JSON { email, token } or just a token (with GMAIL_ADDRESS env)
  try {
    const parsed = JSON.parse(cred);
    return { email: parsed.email || parsed.GMAIL_ADDRESS || '', token: parsed.token || parsed.GMAIL_APP_PASSWORD || '' };
  } catch {
    return { email: process.env.GMAIL_ADDRESS || '', token: cred };
  }
}

/**
 * Hash + length for audit redaction. SHA-256, hex, first 16 chars.
 * Auditors see "something was there" without seeing the content.
 */
function hashAndLength(value: string): { hash: string; length: number } {
  return {
    hash: createHash('sha256').update(value).digest('hex').substring(0, 16),
    length: value.length,
  };
}

/**
 * Classify a Gmail API error response as auth-failure (reauth needed)
 * vs. anything else. Pure function — exported for direct unit testing
 * without a fetch mock.
 *
 * Auth-failure indicators (any one is sufficient):
 *   - HTTP status 401 or 403
 *   - error.status === 'UNAUTHENTICATED' or 'PERMISSION_DENIED'
 *   - lowercased error message contains 'invalid credentials',
 *     'invalid_grant', 'token expired', or 'access denied'
 */
export function isGmailAuthError(status: number, data: Record<string, unknown> | undefined): boolean {
  if (status === 401 || status === 403) return true;
  const err = (data?.error ?? {}) as Record<string, unknown>;
  if (err.status === 'UNAUTHENTICATED' || err.status === 'PERMISSION_DENIED') return true;
  const msg = String((err.message as string | undefined) ?? '').toLowerCase();
  if (
    msg.includes('invalid credentials') ||
    msg.includes('invalid_grant') ||
    msg.includes('token expired') ||
    msg.includes('access denied')
  ) {
    return true;
  }
  return false;
}

async function gmailFetch(
  endpoint: string,
  token: string,
  method = 'GET',
  body?: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const res = await fetch(`${GMAIL_API}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json() as Record<string, unknown>;
    return { status: res.status, data };
  } catch (err: unknown) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Wraps `gmailFetch` and converts auth-failure responses into a
 * structured `ConnectorReauthError` per PR 7's contract. Actions call
 * this instead of `gmailFetch` directly so the throw happens in one
 * place. Non-auth errors pass through as before (caller renders them
 * as `Error: Gmail API <status>: ...` strings).
 */
async function gmailFetchOrReauth(
  endpoint: string,
  token: string,
  method = 'GET',
  body?: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const result = await gmailFetch(endpoint, token, method, body);
  if (isGmailAuthError(result.status, result.data)) {
    const errMsg = String(((result.data?.error as Record<string, unknown> | undefined)?.message as string | undefined) ?? `HTTP ${result.status}`);
    throw new ConnectorReauthError('gmail', `Gmail auth failed (${result.status}): ${errMsg}`);
  }
  return result;
}

function base64Encode(str: string): string {
  return Buffer.from(str).toString('base64url');
}

function base64Decode(str: string): string {
  return Buffer.from(str, 'base64').toString('utf-8');
}

// ─── Read actions ────────────────────────────────────────────────────────

const listEmails: ConnectorAction = {
  name: 'list_emails',
  description: 'List recent emails from your inbox',
  parameters: {
    type: 'object',
    properties: {
      count: { type: 'number', description: 'Number of emails to list (default 10, max 50)' },
      label: { type: 'string', description: 'Label to filter by (default INBOX). Options: INBOX, SENT, DRAFT, STARRED, UNREAD' },
    },
  },
  capabilities: ['read-only', 'account-access', 'net-fetch'],
  // Read-only — no preview / idempotency / redaction required.
  execute: async (args, cred) => {
    const { token } = parseCredential(cred);
    const count = Math.min((args.count as number) || 10, 50);
    const label = (args.label as string) || 'INBOX';

    try {
      const { status, data } = await gmailFetchOrReauth(
        `/messages?maxResults=${count}&labelIds=${encodeURIComponent(label)}`,
        token,
      );
      if (status !== 200) return `Error: Gmail API ${status}: ${JSON.stringify(data).substring(0, 200)}`;

      const messages = (data.messages as Array<{ id: string }>) || [];
      if (!messages.length) return `No emails found in ${label}.`;

      // Fetch headers for each message
      const results: string[] = [];
      for (const msg of messages.slice(0, count)) {
        try {
          const { data: detail } = await gmailFetchOrReauth(`/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, token);
          const headers = (detail.payload as { headers: Array<{ name: string; value: string }> })?.headers || [];
          const from = headers.find(h => h.name === 'From')?.value || '?';
          const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
          const date = headers.find(h => h.name === 'Date')?.value || '';
          const snippet = (detail.snippet as string) || '';
          results.push(`  [${msg.id.substring(0, 8)}] ${from}\n    Subject: ${subject}\n    Date: ${date}\n    ${snippet.substring(0, 80)}`);
        } catch { results.push(`  [${msg.id.substring(0, 8)}] (failed to load)`); }
      }

      return truncate(`Emails in ${label} (${messages.length} total):\n\n${results.join('\n\n')}`);
    } catch (err: unknown) {
      // ConnectorReauthError propagates to AppConnectorTool which
      // catches via isConnectorReauthError. Other errors render
      // as before.
      if (err instanceof ConnectorReauthError) throw err;
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

const readEmail: ConnectorAction = {
  name: 'read_email',
  description: 'Read the full content of a specific email by its ID',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Email message ID' },
    },
    required: ['id'],
  },
  capabilities: ['read-only', 'account-access', 'net-fetch'],
  // Read-only — no preview / idempotency / redaction required.
  execute: async (args, cred) => {
    const { token } = parseCredential(cred);
    const id = args.id as string;
    if (!id) return 'Error: id is required';

    try {
      const { status, data } = await gmailFetchOrReauth(`/messages/${id}?format=full`, token);
      if (status !== 200) return `Error: Gmail API ${status}: ${JSON.stringify(data).substring(0, 200)}`;

      const headers = (data.payload as { headers: Array<{ name: string; value: string }> })?.headers || [];
      const from = headers.find(h => h.name === 'From')?.value || '?';
      const to = headers.find(h => h.name === 'To')?.value || '?';
      const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
      const date = headers.find(h => h.name === 'Date')?.value || '';

      // Extract body text
      let body = '';
      const payload = data.payload as Record<string, unknown>;
      if (payload?.body && (payload.body as Record<string, unknown>).data) {
        body = base64Decode((payload.body as Record<string, string>).data);
      } else if (payload?.parts) {
        const parts = payload.parts as Array<{ mimeType: string; body: { data: string } }>;
        const textPart = parts.find(p => p.mimeType === 'text/plain') || parts[0];
        if (textPart?.body?.data) {
          body = base64Decode(textPart.body.data);
        }
      }

      return truncate(`From: ${from}\nTo: ${to}\nSubject: ${subject}\nDate: ${date}\n\n${body || '(no body)'}`);
    } catch (err: unknown) {
      if (err instanceof ConnectorReauthError) throw err;
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

const searchEmails: ConnectorAction = {
  name: 'search_emails',
  description: 'Search emails using Gmail search syntax',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Gmail search query (e.g., "from:user@example.com subject:invoice")' },
      count: { type: 'number', description: 'Max results (default 10, max 50)' },
    },
    required: ['query'],
  },
  capabilities: ['read-only', 'account-access', 'net-fetch'],
  // Read-only — no preview / idempotency / redaction required.
  // The `query` arg can contain sensitive search terms (e.g., specific
  // recipient addresses) but the verb is read-only and the §8 contract
  // requires redaction for MUTATING verbs only. Read-query redaction
  // would be a §8 amendment, not a Gmail-specific call.
  execute: async (args, cred) => {
    const { token } = parseCredential(cred);
    const query = args.query as string;
    const count = Math.min((args.count as number) || 10, 50);
    if (!query) return 'Error: query is required';

    try {
      const { status, data } = await gmailFetchOrReauth(
        `/messages?q=${encodeURIComponent(query)}&maxResults=${count}`,
        token,
      );
      if (status !== 200) return `Error: Gmail API ${status}: ${JSON.stringify(data).substring(0, 200)}`;

      const messages = (data.messages as Array<{ id: string }>) || [];
      if (!messages.length) return `No emails found for query: "${query}"`;

      const results: string[] = [];
      for (const msg of messages.slice(0, count)) {
        try {
          const { data: detail } = await gmailFetchOrReauth(`/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, token);
          const headers = (detail.payload as { headers: Array<{ name: string; value: string }> })?.headers || [];
          const from = headers.find(h => h.name === 'From')?.value || '?';
          const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
          results.push(`  [${msg.id.substring(0, 8)}] ${from} — ${subject}`);
        } catch { results.push(`  [${msg.id.substring(0, 8)}] (failed to load)`); }
      }

      return truncate(`Search results for "${query}" (${messages.length} matches):\n\n${results.join('\n')}`);
    } catch (err: unknown) {
      if (err instanceof ConnectorReauthError) throw err;
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

// ─── Mutating actions (preview + redact + idempotency declared) ──────────

/**
 * Reason string used by both `send_email` and `create_draft` for the
 * `unsupported` arm of idempotency. Kept as a constant so the
 * reasoning is documented in one place and tests can spot-check the
 * substring.
 */
const GMAIL_IDEMPOTENCY_UNSUPPORTED =
  'Gmail users.messages.send and users.drafts.create are not idempotent — each POST creates a new message/draft regardless of body content. RFC 2822 Message-ID headers are accepted but not used for server-side dedup.';

/**
 * Redact the body field on send/draft args. Body is the largest and
 * most sensitive piece. `to`, `cc`, and `subject` stay intact —
 * auditors need them to make the audit log useful, and the audit log
 * is a local hash-chained file, not a transmission target.
 */
function redactSendArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };
  if (typeof args.body === 'string') {
    const d = hashAndLength(args.body);
    out.body = `<redacted sha256:${d.hash} len:${d.length}>`;
  }
  return out;
}

/**
 * Build a preview for send_email. Pure — no network call. The
 * credential parameter is ignored; preview is "what would happen"
 * computed entirely from the args the user is about to authorize.
 */
function previewSendEmail(args: Record<string, unknown>): ConnectorPreview {
  const to = String(args.to ?? '');
  const cc = typeof args.cc === 'string' ? args.cc : '';
  const subject = String(args.subject ?? '');
  const bodyStr = String(args.body ?? '');
  const bodyDigest = hashAndLength(bodyStr);

  // Attachments are NOT supported by this connector today. Per Alex's
  // PR 8 review: don't render fields the verb doesn't support. When
  // attachments are added, preview gains an attachment summary in
  // that PR — not here.

  const lines = [
    `Would send via Gmail:`,
    `  To:      ${to}`,
  ];
  if (cc) lines.push(`  Cc:      ${cc}`);
  lines.push(`  Subject: ${subject}`);
  lines.push(`  Body:    ${bodyDigest.length} chars (sha256:${bodyDigest.hash})`);

  return {
    summary: lines.join('\n'),
    details: {
      to,
      cc: cc || undefined,
      subject,
      bodyLength: bodyDigest.length,
      bodyHash: bodyDigest.hash,
    },
  };
}

/**
 * Preview for create_draft — same shape as send_email minus cc (the
 * draft action doesn't currently take cc), and the summary makes
 * clear this creates remote draft state, not a sent message.
 */
function previewCreateDraft(args: Record<string, unknown>): ConnectorPreview {
  const to = String(args.to ?? '');
  const subject = String(args.subject ?? '');
  const bodyStr = String(args.body ?? '');
  const bodyDigest = hashAndLength(bodyStr);

  return {
    summary: [
      `Would create a Gmail draft (NOT sent):`,
      `  To:      ${to}`,
      `  Subject: ${subject}`,
      `  Body:    ${bodyDigest.length} chars (sha256:${bodyDigest.hash})`,
    ].join('\n'),
    details: {
      to,
      subject,
      bodyLength: bodyDigest.length,
      bodyHash: bodyDigest.hash,
    },
  };
}

const sendEmail: ConnectorAction = {
  name: 'send_email',
  description: 'Send an email via Gmail',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient email address' },
      subject: { type: 'string', description: 'Email subject' },
      body: { type: 'string', description: 'Email body (plain text)' },
      cc: { type: 'string', description: 'CC recipients (comma-separated)' },
    },
    required: ['to', 'subject', 'body'],
  },
  capabilities: ['account-access', 'net-fetch', 'send-on-behalf'],
  idempotency: {
    kind: 'unsupported',
    reason: GMAIL_IDEMPOTENCY_UNSUPPORTED,
  },
  preview: async (args, _credential): Promise<ConnectorPreview> => previewSendEmail(args),
  redactArgsForAudit: redactSendArgs,
  execute: async (args, cred) => {
    const { email, token } = parseCredential(cred);
    const to = args.to as string;
    const subject = args.subject as string;
    const body = args.body as string;
    if (!to || !subject || !body) return 'Error: to, subject, and body are required';

    try {
      // Build RFC 2822 email
      let rawEmail = `From: ${email}\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n`;
      if (args.cc) rawEmail += `Cc: ${args.cc}\r\n`;
      rawEmail += `\r\n${body}`;

      const encodedMessage = base64Encode(rawEmail);

      const { status, data } = await gmailFetchOrReauth('/messages/send', token, 'POST', {
        raw: encodedMessage,
      });

      if (status === 200 || status === 201) {
        return `Email sent to ${to}. Subject: "${subject}". Message ID: ${(data.id as string) || 'unknown'}`;
      }
      return `Error: Gmail API ${status}: ${JSON.stringify(data).substring(0, 200)}`;
    } catch (err: unknown) {
      if (err instanceof ConnectorReauthError) throw err;
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

const createDraft: ConnectorAction = {
  name: 'create_draft',
  description: 'Create an email draft (does not send)',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient email address' },
      subject: { type: 'string', description: 'Email subject' },
      body: { type: 'string', description: 'Email body (plain text)' },
    },
    required: ['to', 'subject', 'body'],
  },
  // create_draft is labeled `send-on-behalf` even though it does NOT
  // actually send mail. Reasoning: it creates remote account state
  // under the user's identity (a draft visible in their Gmail) and
  // contains message-body PII. Per §8, mutating-account-state verbs
  // need preview + redact + idempotency declaration. Treating it as
  // anything weaker would skip the human review step on "the agent is
  // creating something with my account."
  capabilities: ['account-access', 'net-fetch', 'send-on-behalf'],
  idempotency: {
    kind: 'unsupported',
    reason: GMAIL_IDEMPOTENCY_UNSUPPORTED,
  },
  preview: async (args, _credential): Promise<ConnectorPreview> => previewCreateDraft(args),
  redactArgsForAudit: redactSendArgs,
  execute: async (args, cred) => {
    const { email, token } = parseCredential(cred);
    const to = args.to as string;
    const subject = args.subject as string;
    const body = args.body as string;
    if (!to || !subject || !body) return 'Error: to, subject, and body are required';

    try {
      const rawEmail = `From: ${email}\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`;
      const encodedMessage = base64Encode(rawEmail);

      const { status, data } = await gmailFetchOrReauth('/drafts', token, 'POST', {
        message: { raw: encodedMessage },
      });

      if (status === 200 || status === 201) {
        return `Draft created. To: ${to}, Subject: "${subject}". Draft ID: ${(data.id as string) || 'unknown'}`;
      }
      return `Error: Gmail API ${status}: ${JSON.stringify(data).substring(0, 200)}`;
    } catch (err: unknown) {
      if (err instanceof ConnectorReauthError) throw err;
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export class GmailConnector implements Connector {
  name = 'gmail';
  displayName = 'Gmail';
  description = 'Send, read, search, and draft emails via Gmail. Requires a Gmail API OAuth token or App Password.';
  authType: Connector['authType'] = 'api_key';
  envKey = 'GMAIL_APP_PASSWORD';
  requiredEnvKeys = ['GMAIL_ADDRESS', 'GMAIL_APP_PASSWORD'];
  vaultKeyName = 'gmail';

  actions: ConnectorAction[] = [listEmails, readEmail, sendEmail, searchEmails, createDraft];

  async validate(credential: string): Promise<boolean> {
    const { token } = parseCredential(credential);
    if (!token) return false;
    try {
      const { status } = await gmailFetch('/profile', token);
      return status === 200;
    } catch {
      return false;
    }
  }
}
