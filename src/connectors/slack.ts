/**
 * Slack Connector — Web API + Webhook fallback
 *
 * Auth: Bot Token (xoxb-*) or Webhook URL (https://hooks.slack.com/*)
 * If credential is a webhook URL, only post_message is supported.
 */

import { Connector, ConnectorAction } from './base';

const BASE_URL = 'https://slack.com/api';
const TIMEOUT = 15_000;
const MAX_RESPONSE = 10_000;

function isWebhookUrl(cred: string): boolean {
  return cred.startsWith('https://hooks.slack.com/');
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
    if (res.ok) return 'Message posted via webhook.';
    return `Error: webhook returned ${res.status}`;
  } catch (err: unknown) {
    clearTimeout(timer);
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function truncate(text: string): string {
  return text.length <= MAX_RESPONSE ? text : text.substring(0, MAX_RESPONSE) + '\n... (truncated)';
}

export class SlackConnector implements Connector {
  name = 'slack';
  displayName = 'Slack';
  description = 'Post messages, list channels, and search in Slack workspaces.';
  authType: Connector['authType'] = 'api_key';
  envKey = 'SLACK_TOKEN';

  actions: ConnectorAction[] = [
    {
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
      execute: async (args, cred) => {
        const channel = args.channel as string;
        const message = args.message as string;
        if (!channel || !message) return 'Error: channel and message are required';

        // Webhook mode
        if (isWebhookUrl(cred)) {
          return webhookPost(cred, message, channel);
        }

        // API mode
        try {
          const params: Record<string, unknown> = {
            channel: channel.replace(/^#/, ''),
            text: message,
          };
          if (args.thread_ts) params.thread_ts = args.thread_ts;

          const { ok, data } = await apiCall('chat.postMessage', cred, params);
          if (!ok) return `Error: Slack API: ${data.error || 'unknown error'}`;
          return `Message posted to ${channel}.`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'list_channels',
      description: 'List public channels in the workspace',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of channels to return (default 20, max 100)' },
        },
      },
      execute: async (args, cred) => {
        if (isWebhookUrl(cred)) return 'Error: list_channels requires a Bot Token, not a webhook URL';
        try {
          const limit = Math.min((args.limit as number) || 20, 100);
          const { ok, data } = await apiCall('conversations.list', cred, {
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
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
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
      execute: async (args, cred) => {
        if (isWebhookUrl(cred)) return 'Error: search_messages requires a Bot Token, not a webhook URL';
        const query = args.query as string;
        if (!query) return 'Error: query is required';
        try {
          const count = Math.min((args.count as number) || 10, 50);
          const { ok, data } = await apiCall('search.messages', cred, { query, count });
          if (!ok) return `Error: Slack API: ${data.error || 'unknown error'}`;
          const messages = (data.messages as { matches: Array<{ text: string; username: string; channel: { name: string }; ts: string }> })?.matches || [];
          if (!messages.length) return `No messages found for "${query}".`;
          const lines = messages.map(m =>
            `  [#${m.channel?.name || '?'}] ${m.username || '?'}: ${(m.text || '').substring(0, 100)}`
          );
          return truncate(`Search results (${messages.length}):\n${lines.join('\n')}`);
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ];

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
