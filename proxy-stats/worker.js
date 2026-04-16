/**
 * CodeBot AI — Stats Worker (Cloudflare Workers)
 *
 * Receives anonymous heartbeat pings from CodeBot installs and surfaces
 * aggregate counts at a public dashboard. Distinct from `proxy/` which
 * proxies LLM traffic — this worker NEVER touches LLM API keys, code,
 * or anything but the heartbeat payload.
 *
 * Routes:
 *   POST /api/ping          — ingest one heartbeat ping
 *   GET  /api/stats         — JSON aggregate counts (cached 5 min)
 *   GET  /                  — public HTML dashboard
 *   GET  /health            — liveness check
 *
 * KV bindings (set up via wrangler.toml):
 *   STATS                   — per-day install IDs and aggregate counters
 *
 * Privacy:
 *   - We persist only what the client sent (see PRIVACY.md / heartbeat.ts)
 *   - We do NOT log IP addresses (Cloudflare may keep its own connection
 *     logs per their privacy policy; we never read them)
 *   - We do NOT set cookies, fingerprint, or correlate pings across days
 *     (the per-day rotating installation_id makes that mathematically
 *     impossible)
 */

const ALLOWED_ORIGINS = ['*']; // public dashboard reads, no auth needed
const PING_TTL_DAYS = 90;       // we only need recent days for "active" counts
const STATS_CACHE_TTL_SEC = 300; // recompute aggregate at most every 5 min

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {
      if (url.pathname === '/health') return json({ status: 'ok' });
      if (url.pathname === '/api/ping' && request.method === 'POST') return await handlePing(request, env);
      if (url.pathname === '/api/stats' && request.method === 'GET') return await handleStats(env);
      if (url.pathname === '/' || url.pathname === '/index.html') return dashboardHtml();
      return notFound();
    } catch (err) {
      console.error('worker error', err);
      return json({ error: 'internal' }, 500);
    }
  },
};

async function handlePing(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  if (!validatePayload(body)) {
    return json({ error: 'invalid_payload' }, 400);
  }

  const today = todayUtc();
  const key = `ping:${today}:${body.installation_id}`;

  // KV write is fire-and-forget from caller's perspective. We overwrite
  // duplicates within the same day (idempotent). TTL ensures cleanup
  // without us having to garbage collect.
  await env.STATS.put(
    key,
    JSON.stringify({
      v: body.version,
      o: body.os,
      n: body.node,
      f: body.first_seen_week,
      t: Date.now(),
    }),
    { expirationTtl: PING_TTL_DAYS * 86400 },
  );

  return json({ ok: true });
}

async function handleStats(env) {
  // Cheap response from edge cache when available.
  const cached = await env.STATS.get('cache:stats', { type: 'json' });
  if (cached && cached._cachedAt && Date.now() - cached._cachedAt < STATS_CACHE_TTL_SEC * 1000) {
    return json(cached);
  }

  const stats = await computeStats(env);
  stats._cachedAt = Date.now();
  await env.STATS.put('cache:stats', JSON.stringify(stats), { expirationTtl: STATS_CACHE_TTL_SEC });
  return json(stats);
}

async function computeStats(env) {
  // List all keys with prefix "ping:". Cloudflare KV returns paginated
  // chunks of up to 1000 keys. For day-0 counts (low traffic) one page
  // is plenty; we'll add cursor pagination once we cross 1k pings/day.
  const list = await env.STATS.list({ prefix: 'ping:', limit: 1000 });
  const today = todayUtc();
  const last7 = lastNDates(7);
  const last30 = lastNDates(30);

  const dailyActive = {};   // YYYY-MM-DD → set of installation_ids (we use count)
  const versionCount = {};  // version string → count of pings
  const osCount = {};       // os string → count
  let totalPings = 0;
  let dailyActiveToday = 0;
  let weeklyActive = 0;
  let monthlyActive = 0;

  // First pass: count basic metrics from key names alone.
  for (const k of list.keys) {
    // Key shape: "ping:YYYY-MM-DD:<id>"
    const parts = k.name.split(':');
    if (parts.length !== 3) continue;
    const day = parts[1];
    const id = parts[2];

    totalPings++;
    if (!dailyActive[day]) dailyActive[day] = new Set();
    dailyActive[day].add(id);
    if (day === today) dailyActiveToday++;
    if (last7.includes(day)) weeklyActive++;
    if (last30.includes(day)) monthlyActive++;
  }

  // Second pass for version / os distribution requires reading values.
  // Skip on large lists to keep this cheap; only run when we have <500 pings.
  if (list.keys.length < 500) {
    for (const k of list.keys) {
      const v = await env.STATS.get(k.name, { type: 'json' });
      if (!v) continue;
      versionCount[v.v] = (versionCount[v.v] || 0) + 1;
      osCount[v.o] = (osCount[v.o] || 0) + 1;
    }
  }

  return {
    generated_at: new Date().toISOString(),
    today_utc: today,
    total_pings_last_90d: totalPings,
    daily_active_today: dailyActiveToday,
    weekly_active: weeklyActive,
    monthly_active: monthlyActive,
    version_distribution: versionCount,
    os_distribution: osCount,
    note: 'Per-day rotating installation_id means each day_active count is unique installs that day, but the same install across multiple days appears as different IDs. Weekly/monthly active counts include duplicates — they are upper bounds, not unique-install counts.',
  };
}

// ── helpers ──

function validatePayload(p) {
  if (!p || typeof p !== 'object') return false;
  if (typeof p.installation_id !== 'string' || !/^[a-f0-9]{32}$/.test(p.installation_id)) return false;
  if (typeof p.version !== 'string' || p.version.length > 32) return false;
  if (typeof p.os !== 'string' || p.os.length > 32) return false;
  if (typeof p.node !== 'string' || p.node.length > 8) return false;
  if (typeof p.first_seen_week !== 'string' || !/^\d{4}-W\d{2}$/.test(p.first_seen_week)) return false;
  if (p.active_today !== true) return false;
  // Reject anything else — strict allow-list.
  const allowedKeys = new Set(['installation_id', 'version', 'os', 'node', 'first_seen_week', 'active_today']);
  for (const k of Object.keys(p)) {
    if (!allowedKeys.has(k)) return false;
  }
  return true;
}

function todayUtc() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function lastNDates(n) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
  }
  return out;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.join(', '),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function notFound() {
  return new Response('Not found', { status: 404 });
}

function dashboardHtml() {
  // Self-contained HTML — no external dependencies, no fonts, no analytics.
  // Fetches /api/stats and renders a few numbers + tables.
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CodeBot AI — Public Stats</title>
<style>
  body { font: 16px/1.5 -apple-system, system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #111; background: #fafafa; }
  h1 { margin: 0 0 8px; font-size: 28px; }
  .sub { color: #666; margin-bottom: 32px; font-size: 14px; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 32px; }
  .card { background: white; padding: 20px; border-radius: 8px; border: 1px solid #e5e5e5; }
  .card .num { font-size: 36px; font-weight: 600; line-height: 1; margin: 4px 0 8px; }
  .card .label { color: #666; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 24px; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #eee; }
  th { color: #666; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  .footer { color: #888; font-size: 13px; margin-top: 48px; border-top: 1px solid #e5e5e5; padding-top: 16px; }
  a { color: #0366d6; }
  code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; font-size: 13px; }
</style>
</head>
<body>
<h1>CodeBot AI — Public Stats</h1>
<p class="sub">
  Aggregate counts from the anonymous opt-in heartbeat. Each install can choose to send one ping per day with version, OS, and Node version — nothing else.
  <a href="https://github.com/Ascendral/codebot-ai/blob/main/docs/PRIVACY.md">Privacy policy</a> ·
  <a href="https://github.com/Ascendral/codebot-ai">Source</a>
</p>

<div class="grid">
  <div class="card"><div class="label">Active Today</div><div class="num" id="today">—</div></div>
  <div class="card"><div class="label">Weekly Active</div><div class="num" id="weekly">—</div></div>
  <div class="card"><div class="label">Monthly Active</div><div class="num" id="monthly">—</div></div>
  <div class="card"><div class="label">Pings (last 90d)</div><div class="num" id="total">—</div></div>
</div>

<h3>Version distribution</h3>
<table id="versions"><thead><tr><th>Version</th><th>Pings (90d)</th></tr></thead><tbody><tr><td colspan="2">loading…</td></tr></tbody></table>

<h3>OS distribution</h3>
<table id="os"><thead><tr><th>OS / Arch</th><th>Pings (90d)</th></tr></thead><tbody><tr><td colspan="2">loading…</td></tr></tbody></table>

<p class="footer">
  Generated <span id="ts">—</span> · refreshes every 5 min ·
  <a href="/api/stats">raw JSON</a>
</p>

<script>
fetch('/api/stats').then(r => r.json()).then(s => {
  document.getElementById('today').textContent = s.daily_active_today;
  document.getElementById('weekly').textContent = s.weekly_active;
  document.getElementById('monthly').textContent = s.monthly_active;
  document.getElementById('total').textContent = s.total_pings_last_90d;
  document.getElementById('ts').textContent = new Date(s.generated_at).toLocaleString();

  function renderTable(tbody, dist) {
    if (!dist || Object.keys(dist).length === 0) {
      tbody.innerHTML = '<tr><td colspan="2">no data yet</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    const sorted = Object.entries(dist).sort((a, b) => b[1] - a[1]);
    for (const [k, v] of sorted) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td><code>' + escapeHtml(k) + '</code></td><td>' + v + '</td>';
      tbody.appendChild(tr);
    }
  }

  renderTable(document.querySelector('#versions tbody'), s.version_distribution);
  renderTable(document.querySelector('#os tbody'), s.os_distribution);
}).catch(err => {
  document.body.insertAdjacentHTML('beforeend', '<p style="color:#c00">Failed to load stats: ' + err.message + '</p>');
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
</script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() },
  });
}
