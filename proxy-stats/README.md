# proxy-stats — heartbeat ingest + public stats dashboard

Cloudflare Worker that answers the anonymous opt-in heartbeat from CodeBot installs and serves an aggregated public dashboard. Pairs with `src/heartbeat.ts` in the main repo.

## What it does

| Route | Purpose |
|---|---|
| `POST /api/ping` | Accepts one heartbeat payload, validates schema strictly, stores in KV with 90-day TTL |
| `GET /api/stats` | Returns aggregate counts as JSON (cached 5 min) |
| `GET /` | Public HTML dashboard (no JS frameworks, no analytics, no fonts) |
| `GET /health` | Liveness check |

## What it does NOT do

- Read or store IP addresses
- Set cookies
- Fingerprint anything
- Run any analytics
- Make external API calls
- Log payloads beyond the 6 documented fields (rejected with 400 if anything else is present)

## Deploy

One-time setup:
```
npm install -g wrangler
wrangler login
cd proxy-stats
wrangler kv:namespace create "STATS"
```

Paste the returned namespace id into `wrangler.toml` (uncomment the `[[kv_namespaces]]` block), then:
```
wrangler deploy
```

The worker will be available at `https://codebot-stats.<your-subdomain>.workers.dev` (subdomain is whatever Cloudflare assigned to your account). That URL needs to match the `DEFAULT_HEARTBEAT_URL` constant in `src/heartbeat.ts` (currently set to `https://codebot-stats.workers.dev/api/ping`). Update one or the other if they don't match.

## Test locally

```
wrangler dev
```

Then in another terminal:
```bash
# Send a fake ping
curl -X POST http://localhost:8787/api/ping \
  -H 'Content-Type: application/json' \
  -d '{
    "installation_id": "0123456789abcdef0123456789abcdef",
    "version": "2.10.0",
    "os": "darwin-arm64",
    "node": "20",
    "first_seen_week": "2026-W16",
    "active_today": true
  }'

# Check stats
curl http://localhost:8787/api/stats
```

## Schema (strict allow-list)

The worker rejects any payload that doesn't match this exact shape:

```json
{
  "installation_id": "<32 lowercase hex chars>",
  "version": "<string, max 32>",
  "os": "<string, max 32>",
  "node": "<string, max 8>",
  "first_seen_week": "<YYYY-Www>",
  "active_today": true
}
```

Extra keys → 400. This is intentional. Keeps the schema minimal and prevents future drift from adding personal data by accident.

## Cost

Cloudflare Workers free tier:
- 100k requests/day
- KV: 100k reads/day, 1k writes/day, 1GB storage

For the projected first 12 months (1k active installs × 1 ping/day = 1k writes/day) we are well within free tier. Past ~5k installs, the KV write quota hits and we either upgrade to the $5/mo plan or batch writes.

## Audit

The entire data path is in `worker.js` (~250 lines). Read it. The only persistent storage is Cloudflare KV with the documented schema. There's no log destination beyond Cloudflare's own platform logs (which we never read).
