/**
 * Outbound-network safety guard with DNS resolution.
 *
 * P2-1 fix: the previous SSRF checks (web-fetch.ts, http-client.ts)
 * only inspected the literal hostname string. A domain like
 * `internal.evil.example.com` whose A-record resolves to 10.0.0.1
 * or 127.0.0.1 would pass validation because "internal.evil.example.com"
 * is not 10.x.x.x or 127.x.x.x as a literal string. This module closes
 * that gap by resolving the hostname and checking every returned IP
 * against the same deny-list.
 *
 * Usage:
 *     const block = await validateOutboundUrl(userProvidedUrl);
 *     if (block) return `Error: ${block}`;
 *
 * Design notes:
 *   - Pure functions + one async boundary at the DNS step. Easy to test,
 *     easy to reason about.
 *   - `ipIsPrivate` centralizes the range table so future tweaks (e.g.
 *     adding a customer-defined allow/deny range) happen in one place.
 *   - DNS resolution uses `dns.lookup` with `all: true` — identical to
 *     what Node will do during the actual fetch, so there is no TOCTOU
 *     in the common case. We intentionally do NOT retry with a longer
 *     timeout or resolve both A and AAAA separately; lookup covers both.
 *   - A hostname that doesn't resolve at all → we do NOT block it.
 *     That would make the fetch fail on its own with a clearer error.
 */

import { lookup as dnsLookup } from 'dns';
import { promisify } from 'util';

const lookupAsync = promisify(dnsLookup);

/**
 * Return a human-readable block reason if the IP is in a private /
 * loopback / link-local / ULA / metadata / multicast / reserved range.
 * Returns null if the IP is safe to dial.
 *
 * Handles both IPv4 ("10.0.0.1") and IPv6 ("fd00::1", "::ffff:10.0.0.1").
 */
export function ipIsPrivate(ip: string): string | null {
  if (!ip) return 'Blocked: empty IP';
  const lower = ip.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');

  // ── IPv4 literal ─────────────────────────────────────────────────
  const v4 = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [, a, b] = v4.map(Number);
    if (a === 127) return `Blocked: loopback IP (${ip})`;
    if (a === 10) return `Blocked: private IP 10.x.x.x (${ip})`;
    if (a === 172 && b >= 16 && b <= 31) return `Blocked: private IP 172.16-31.x.x (${ip})`;
    if (a === 192 && b === 168) return `Blocked: private IP 192.168.x.x (${ip})`;
    if (a === 0) return `Blocked: reserved IP 0.x.x.x (${ip})`;
    if (a === 169 && b === 254) return `Blocked: link-local IP 169.254.x.x (${ip})`;
    if (a >= 224) return `Blocked: multicast/reserved IP ${a}.x.x.x (${ip})`;
    // Cloud metadata endpoint (literal match)
    if (ip === '169.254.169.254') return `Blocked: cloud metadata endpoint (${ip})`;
    return null;
  }

  // ── IPv6 literal ─────────────────────────────────────────────────
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return `Blocked: IPv6 loopback (${ip})`;
  if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return `Blocked: IPv6 unspecified (${ip})`;
  if (/^fe[89ab][0-9a-f]:/i.test(lower)) return `Blocked: IPv6 link-local fe80::/10 (${ip})`;
  if (/^f[cd][0-9a-f]{2}:/i.test(lower)) return `Blocked: IPv6 unique local fc00::/7 (${ip})`;
  if (/^ff[0-9a-f]{2}:/i.test(lower)) return `Blocked: IPv6 multicast ff00::/8 (${ip})`;

  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — delegate to v4 check
  const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) {
    const v4reason = ipIsPrivate(mapped[1]);
    if (v4reason) return `Blocked: IPv4-mapped ${v4reason.replace(/^Blocked:\s*/, '')}`;
    return null;
  }

  return null;
}

/**
 * Cheap pre-filter on a hostname that is obviously a name (not an IP,
 * not "localhost"). We call this BEFORE DNS resolution so obvious
 * bad cases fail fast.
 */
export function checkHostnameLiteral(hostname: string): string | null {
  if (!hostname) return 'Blocked: empty hostname';
  const lower = hostname.toLowerCase();

  // Named loopbacks / metadata
  if (lower === 'localhost') return 'Blocked: localhost';
  if (lower === '0.0.0.0') return 'Blocked: 0.0.0.0';
  if (lower === 'metadata.google.internal') return 'Blocked: GCP metadata endpoint';
  if (lower === 'metadata') return 'Blocked: metadata shorthand';

  // Literal IP addresses — delegate to ipIsPrivate
  const bare = lower.replace(/^\[/, '').replace(/\]$/, '');
  if (/^[\d.]+$/.test(bare) || bare.includes(':')) {
    return ipIsPrivate(bare);
  }
  return null;
}

/**
 * Resolve the hostname and reject if ANY returned address is in a
 * private range. `dns.lookup(..., { all: true })` returns every
 * address the OS resolver would use — which is exactly what the real
 * fetch call will see next, so the check and the fetch stay in sync.
 */
export async function resolveAndCheck(hostname: string): Promise<string | null> {
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookupAsync(hostname, { all: true });
  } catch {
    // DNS failure: we don't block here — let the actual fetch fail
    // with its own error, which is more informative to the user than
    // "blocked due to unresolvable hostname" (which it isn't).
    return null;
  }
  for (const { address } of addresses) {
    const reason = ipIsPrivate(address);
    if (reason) {
      return `${reason} — hostname "${hostname}" resolved to ${address}`;
    }
  }
  return null;
}

/**
 * One-call safety check for outbound URLs. Returns a block reason
 * string, or null if the URL is safe to fetch.
 *
 * Also rejects non-http(s) protocols up front since file:// / gopher://
 * / data:// URLs shouldn't go through a fetch tool.
 */
export async function validateOutboundUrl(url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `Invalid URL: ${url}`;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `Blocked protocol: ${parsed.protocol} — only http/https allowed`;
  }
  const literal = checkHostnameLiteral(parsed.hostname);
  if (literal) return literal;

  // If the hostname was a literal IP, the literal check has already
  // answered and we return null here without a DNS round-trip.
  const bare = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '');
  const isIpLiteral = /^[\d.]+$/.test(bare) || bare.includes(':');
  if (isIpLiteral) return null;

  return resolveAndCheck(parsed.hostname);
}
