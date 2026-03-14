/**
 * X (Twitter) Connector — X API v2
 *
 * Auth: JSON credential bundle with OAuth 1.0a keys for posting:
 *   { "apiKey": "...", "apiSecret": "...", "accessToken": "...", "accessSecret": "..." }
 *
 * Or set env vars: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET
 *
 * Uses OAuth 1.0a HMAC-SHA1 signature for tweet creation (X API v2 requires user context).
 * Zero external dependencies — crypto + native fetch only.
 */

import { Connector, ConnectorAction } from './base';
import * as crypto from 'crypto';

const BASE_URL = 'https://api.x.com/2';
const TIMEOUT = 15_000;
const MAX_TWEET_LENGTH = 280;

interface XCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
}

/** Parse credential — JSON bundle or env var assembly */
function parseCredentials(credential: string): XCredentials {
  try {
    const parsed = JSON.parse(credential);
    if (parsed.apiKey && parsed.apiSecret && parsed.accessToken && parsed.accessSecret) {
      return parsed as XCredentials;
    }
  } catch { /* not JSON, try env assembly */ }

  // Env var fallback (credential might be a dummy marker like "env")
  const apiKey = process.env.X_API_KEY || process.env.TWITTER_API_KEY || '';
  const apiSecret = process.env.X_API_SECRET || process.env.TWITTER_API_SECRET || '';
  const accessToken = process.env.X_ACCESS_TOKEN || process.env.TWITTER_ACCESS_TOKEN || '';
  const accessSecret = process.env.X_ACCESS_SECRET || process.env.TWITTER_ACCESS_SECRET || '';

  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    throw new Error(
      'X credentials incomplete. Provide JSON: { "apiKey", "apiSecret", "accessToken", "accessSecret" } ' +
      'or set env vars: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET'
    );
  }

  return { apiKey, apiSecret, accessToken, accessSecret };
}

/** Generate OAuth 1.0a signature for X API requests */
function generateOAuthHeader(
  method: string,
  url: string,
  creds: XCredentials,
  body?: string,
): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');

  const params: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };

  // Build signature base string
  const sortedParams = Object.keys(params).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  const baseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(sortedParams),
  ].join('&');

  const signingKey = `${encodeURIComponent(creds.apiSecret)}&${encodeURIComponent(creds.accessSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  params.oauth_signature = signature;

  const header = Object.keys(params).sort()
    .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(params[k])}"`)
    .join(', ');

  return `OAuth ${header}`;
}

/** Make an authenticated X API v2 request */
async function xApiCall(
  method: string,
  endpoint: string,
  creds: XCredentials,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const url = `${BASE_URL}${endpoint}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const authHeader = generateOAuthHeader(method, url, creds, bodyStr);

    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: bodyStr,
      signal: controller.signal,
    });
    clearTimeout(timer);

    const data = await res.json() as Record<string, unknown>;
    return { ok: res.ok, data };
  } catch (err: unknown) {
    clearTimeout(timer);
    throw err;
  }
}

export class XTwitterConnector implements Connector {
  name = 'x';
  displayName = 'X (Twitter)';
  description = 'Post tweets, reply to threads, and search on X (Twitter).';
  authType: Connector['authType'] = 'api_key';
  envKey = 'X_API_KEY';
  requiredEnvKeys = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];

  actions: ConnectorAction[] = [
    {
      name: 'post_tweet',
      description: 'Post a tweet on X',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Tweet text (max 280 characters)' },
          reply_to: { type: 'string', description: 'Tweet ID to reply to (for threads)' },
        },
        required: ['message'],
      },
      execute: async (args, cred) => {
        const message = args.message as string;
        if (!message) return 'Error: message is required';
        if (message.length > MAX_TWEET_LENGTH) {
          return `Error: tweet is ${message.length} characters (max ${MAX_TWEET_LENGTH}). Shorten it or split into a thread.`;
        }

        try {
          const creds = parseCredentials(cred);
          const body: Record<string, unknown> = { text: message };

          if (args.reply_to) {
            body.reply = { in_reply_to_tweet_id: args.reply_to as string };
          }

          const { ok, data } = await xApiCall('POST', '/tweets', creds, body);

          if (!ok) {
            const detail = (data as any).detail || (data as any).title || JSON.stringify(data);
            return `Error: X API: ${detail}`;
          }

          const tweetData = (data as any).data;
          const tweetId = tweetData?.id || 'unknown';
          const tweetUrl = `https://x.com/i/web/status/${tweetId}`;
          return `Tweet posted successfully!\nID: ${tweetId}\nURL: ${tweetUrl}\nText: ${message}`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'post_thread',
      description: 'Post a multi-tweet thread on X',
      parameters: {
        type: 'object',
        properties: {
          tweets: { type: 'string', description: 'Tweets separated by |||  (e.g., "First tweet ||| Second tweet ||| Third tweet")' },
        },
        required: ['tweets'],
      },
      execute: async (args, cred) => {
        const tweetsRaw = args.tweets as string;
        if (!tweetsRaw) return 'Error: tweets are required (separate with |||)';

        const tweets = tweetsRaw.split('|||').map(t => t.trim()).filter(Boolean);
        if (tweets.length < 2) return 'Error: thread needs at least 2 tweets (separate with |||)';

        for (let i = 0; i < tweets.length; i++) {
          if (tweets[i].length > MAX_TWEET_LENGTH) {
            return `Error: tweet ${i + 1} is ${tweets[i].length} chars (max ${MAX_TWEET_LENGTH})`;
          }
        }

        try {
          const creds = parseCredentials(cred);
          const results: string[] = [];
          let lastTweetId: string | null = null;

          for (let i = 0; i < tweets.length; i++) {
            const body: Record<string, unknown> = { text: tweets[i] };
            if (lastTweetId) {
              body.reply = { in_reply_to_tweet_id: lastTweetId };
            }

            const { ok, data } = await xApiCall('POST', '/tweets', creds, body);
            if (!ok) {
              const detail = (data as any).detail || JSON.stringify(data);
              return `Error posting tweet ${i + 1}: ${detail}\nPosted ${i} of ${tweets.length} tweets.`;
            }

            lastTweetId = (data as any).data?.id;
            results.push(`  ${i + 1}. ${tweets[i].substring(0, 50)}... → ${lastTweetId}`);

            // Small delay between tweets to avoid rate limiting
            if (i < tweets.length - 1) {
              await new Promise(r => setTimeout(r, 500));
            }
          }

          const threadUrl = `https://x.com/i/web/status/${results.length > 0 ? lastTweetId : 'unknown'}`;
          return `Thread posted! (${tweets.length} tweets)\n${results.join('\n')}\nThread: ${threadUrl}`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'delete_tweet',
      description: 'Delete a tweet by ID',
      parameters: {
        type: 'object',
        properties: {
          tweet_id: { type: 'string', description: 'ID of the tweet to delete' },
        },
        required: ['tweet_id'],
      },
      execute: async (args, cred) => {
        const tweetId = args.tweet_id as string;
        if (!tweetId) return 'Error: tweet_id is required';

        try {
          const creds = parseCredentials(cred);
          const { ok, data } = await xApiCall('DELETE', `/tweets/${tweetId}`, creds);

          if (!ok) {
            const detail = (data as any).detail || JSON.stringify(data);
            return `Error: ${detail}`;
          }

          return `Tweet ${tweetId} deleted.`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'get_me',
      description: 'Get the authenticated user profile',
      parameters: { type: 'object', properties: {} },
      execute: async (_args, cred) => {
        try {
          const creds = parseCredentials(cred);
          const { ok, data } = await xApiCall('GET', '/users/me?user.fields=public_metrics,description,created_at', creds);

          if (!ok) {
            const detail = (data as any).detail || JSON.stringify(data);
            return `Error: ${detail}`;
          }

          const user = (data as any).data;
          if (!user) return 'Error: no user data returned';

          const metrics = user.public_metrics || {};
          return [
            `@${user.username} (${user.name})`,
            user.description ? `Bio: ${user.description}` : '',
            `Followers: ${metrics.followers_count || 0} | Following: ${metrics.following_count || 0}`,
            `Tweets: ${metrics.tweet_count || 0}`,
            `Joined: ${user.created_at || 'unknown'}`,
          ].filter(Boolean).join('\n');
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'search_tweets',
      description: 'Search recent tweets (last 7 days)',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (X search syntax supported)' },
          count: { type: 'number', description: 'Number of results (default 10, max 100)' },
        },
        required: ['query'],
      },
      execute: async (args, cred) => {
        const query = args.query as string;
        if (!query) return 'Error: query is required';

        try {
          const creds = parseCredentials(cred);
          const count = Math.min((args.count as number) || 10, 100);
          const endpoint = `/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=${count}&tweet.fields=created_at,public_metrics,author_id`;

          const { ok, data } = await xApiCall('GET', endpoint, creds);

          if (!ok) {
            const detail = (data as any).detail || JSON.stringify(data);
            return `Error: ${detail}`;
          }

          const tweets = (data as any).data as Array<{ text: string; id: string; created_at: string; public_metrics?: { like_count: number; retweet_count: number } }>;
          if (!tweets?.length) return `No tweets found for "${query}".`;

          const lines = tweets.map(t => {
            const metrics = t.public_metrics;
            const stats = metrics ? ` [♥${metrics.like_count} ↺${metrics.retweet_count}]` : '';
            return `  ${t.text.substring(0, 120)}${stats}\n    → https://x.com/i/web/status/${t.id}`;
          });

          return `Search results (${tweets.length}):\n${lines.join('\n')}`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ];

  async validate(credential: string): Promise<boolean> {
    try {
      const creds = parseCredentials(credential);
      const { ok } = await xApiCall('GET', '/users/me', creds);
      return ok;
    } catch {
      return false;
    }
  }
}
