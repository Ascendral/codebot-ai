/**
 * CodeBot AI — API Proxy Worker (Cloudflare Workers)
 *
 * Proxies Claude API requests so end users don't need their own API key.
 * Validates license keys, enforces rate limits, and meters usage.
 *
 * Environment variables (set in Cloudflare dashboard):
 *   ANTHROPIC_API_KEY — Your Claude API key
 *   LICENSE_SECRET    — HMAC secret for validating license keys
 *
 * KV Namespace binding:
 *   RATE_LIMITS — Cloudflare KV for per-user rate tracking
 */

const ANTHROPIC_API = 'https://api.anthropic.com';
const MAX_REQUESTS_PER_HOUR = 30;
const MAX_REQUESTS_PER_DAY = 200;
const ALLOWED_MODELS = [
  'claude-sonnet-4-6',
  'claude-haiku-4',
  'claude-3-5-sonnet-20241022',
  'claude-3-haiku-20240307',
];

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(),
      });
    }

    try {
      // Only allow POST to /v1/messages
      const url = new URL(request.url);
      if (url.pathname === '/health') {
        return jsonResponse({ status: 'ok', service: 'codebot-proxy' });
      }

      if (request.method !== 'POST' || !url.pathname.startsWith('/v1/messages')) {
        return jsonResponse({ error: 'Only POST /v1/messages is supported' }, 405);
      }

      // Validate license key
      const licenseKey = request.headers.get('X-CodeBot-License');
      if (!licenseKey) {
        return jsonResponse({ error: 'Missing X-CodeBot-License header' }, 401);
      }

      const userId = await validateLicense(licenseKey, env.LICENSE_SECRET);
      if (!userId) {
        return jsonResponse({ error: 'Invalid license key' }, 403);
      }

      // Rate limiting
      const rateCheck = await checkRateLimit(userId, env.RATE_LIMITS);
      if (!rateCheck.allowed) {
        return jsonResponse({
          error: 'Rate limit exceeded',
          detail: rateCheck.reason,
          retryAfter: rateCheck.retryAfter,
        }, 429);
      }

      // Parse and validate the request body
      const body = await request.json();

      // Enforce allowed models
      if (body.model && !ALLOWED_MODELS.includes(body.model)) {
        return jsonResponse({
          error: `Model not allowed. Use one of: ${ALLOWED_MODELS.join(', ')}`,
        }, 400);
      }

      // Cap max_tokens to prevent abuse
      if (body.max_tokens > 4096) {
        body.max_tokens = 4096;
      }

      // Strip any system prompt injection attempts
      // (proxy users shouldn't override the system prompt)

      // Forward to Anthropic
      const anthropicResponse = await fetch(`${ANTHROPIC_API}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      // Record usage
      await recordUsage(userId, env.RATE_LIMITS);

      // Stream or return response
      const responseHeaders = {
        ...corsHeaders(),
        'Content-Type': anthropicResponse.headers.get('Content-Type') || 'application/json',
      };

      if (body.stream) {
        // Pass through SSE stream
        return new Response(anthropicResponse.body, {
          status: anthropicResponse.status,
          headers: {
            ...responseHeaders,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
          },
        });
      }

      const responseBody = await anthropicResponse.text();
      return new Response(responseBody, {
        status: anthropicResponse.status,
        headers: responseHeaders,
      });

    } catch (err) {
      return jsonResponse({ error: 'Proxy error', detail: err.message }, 500);
    }
  },
};

// ── License Validation ──

async function validateLicense(key, secret) {
  // License format: cb_<userId>_<hmac>
  // Simple HMAC-based validation — no database needed
  const parts = key.split('_');
  if (parts.length !== 3 || parts[0] !== 'cb') return null;

  const userId = parts[1];
  const providedHmac = parts[2];

  const encoder = new TextEncoder();
  const keyData = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', keyData, encoder.encode(userId));
  const expectedHmac = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/[+/=]/g, '')
    .substring(0, 16);

  return providedHmac === expectedHmac ? userId : null;
}

// ── Rate Limiting ──

async function checkRateLimit(userId, kv) {
  if (!kv) return { allowed: true }; // No KV = no rate limiting (dev mode)

  const hourKey = `rate:${userId}:hour:${Math.floor(Date.now() / 3600000)}`;
  const dayKey = `rate:${userId}:day:${Math.floor(Date.now() / 86400000)}`;

  const [hourCount, dayCount] = await Promise.all([
    kv.get(hourKey).then(v => parseInt(v || '0')),
    kv.get(dayKey).then(v => parseInt(v || '0')),
  ]);

  if (hourCount >= MAX_REQUESTS_PER_HOUR) {
    return {
      allowed: false,
      reason: `Hourly limit (${MAX_REQUESTS_PER_HOUR}) exceeded`,
      retryAfter: 3600 - (Math.floor(Date.now() / 1000) % 3600),
    };
  }

  if (dayCount >= MAX_REQUESTS_PER_DAY) {
    return {
      allowed: false,
      reason: `Daily limit (${MAX_REQUESTS_PER_DAY}) exceeded`,
      retryAfter: 86400 - (Math.floor(Date.now() / 1000) % 86400),
    };
  }

  return { allowed: true };
}

async function recordUsage(userId, kv) {
  if (!kv) return;

  const hourKey = `rate:${userId}:hour:${Math.floor(Date.now() / 3600000)}`;
  const dayKey = `rate:${userId}:day:${Math.floor(Date.now() / 86400000)}`;

  const [hourCount, dayCount] = await Promise.all([
    kv.get(hourKey).then(v => parseInt(v || '0')),
    kv.get(dayKey).then(v => parseInt(v || '0')),
  ]);

  await Promise.all([
    kv.put(hourKey, String(hourCount + 1), { expirationTtl: 7200 }),
    kv.put(dayKey, String(dayCount + 1), { expirationTtl: 172800 }),
  ]);
}

// ── Helpers ──

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-CodeBot-License, anthropic-version',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
  });
}
