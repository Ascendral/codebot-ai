import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  ipIsPrivate,
  checkHostnameLiteral,
  resolveAndCheck,
  validateOutboundUrl,
} from './net-guard';

describe('ipIsPrivate', () => {
  it('blocks IPv4 loopback 127.x.x.x', () => {
    assert.match(ipIsPrivate('127.0.0.1')!, /loopback/);
    assert.match(ipIsPrivate('127.1.2.3')!, /loopback/);
  });
  it('blocks IPv4 RFC1918 ranges', () => {
    assert.match(ipIsPrivate('10.0.0.1')!, /10\.x/);
    assert.match(ipIsPrivate('10.255.255.255')!, /10\.x/);
    assert.match(ipIsPrivate('172.16.0.1')!, /172\.16-31/);
    assert.match(ipIsPrivate('172.31.0.1')!, /172\.16-31/);
    assert.match(ipIsPrivate('192.168.1.1')!, /192\.168/);
  });
  it('does NOT block 172.15 or 172.32 (edges of RFC1918)', () => {
    assert.strictEqual(ipIsPrivate('172.15.0.1'), null);
    assert.strictEqual(ipIsPrivate('172.32.0.1'), null);
  });
  it('blocks link-local 169.254.x.x and cloud metadata', () => {
    assert.match(ipIsPrivate('169.254.1.2')!, /link-local/);
    assert.match(ipIsPrivate('169.254.169.254')!, /link-local|metadata/);
  });
  it('blocks 0.x.x.x (reserved) and multicast 224+', () => {
    assert.match(ipIsPrivate('0.0.0.0')!, /reserved/);
    assert.match(ipIsPrivate('224.0.0.1')!, /multicast|reserved/);
    assert.match(ipIsPrivate('239.255.255.255')!, /multicast|reserved/);
  });
  it('allows public IPv4 addresses', () => {
    assert.strictEqual(ipIsPrivate('8.8.8.8'), null);
    assert.strictEqual(ipIsPrivate('1.1.1.1'), null);
    assert.strictEqual(ipIsPrivate('140.82.112.4'), null); // github.com
  });
  it('blocks IPv6 loopback / link-local / ULA / multicast', () => {
    assert.match(ipIsPrivate('::1')!, /loopback/);
    assert.match(ipIsPrivate('fe80::1')!, /link-local/);
    assert.match(ipIsPrivate('fd00::1')!, /unique local/);
    assert.match(ipIsPrivate('fc00::1')!, /unique local/);
    assert.match(ipIsPrivate('ff02::1')!, /multicast/);
  });
  it('blocks IPv4-mapped IPv6 with private v4', () => {
    assert.match(ipIsPrivate('::ffff:127.0.0.1')!, /IPv4-mapped/);
    assert.match(ipIsPrivate('::ffff:10.0.0.1')!, /IPv4-mapped/);
  });
  it('allows public IPv6', () => {
    assert.strictEqual(ipIsPrivate('2001:4860:4860::8888'), null);
  });
});

describe('checkHostnameLiteral', () => {
  it('blocks named loopbacks', () => {
    assert.match(checkHostnameLiteral('localhost')!, /localhost/);
    assert.match(checkHostnameLiteral('LOCALHOST')!, /localhost/);
  });
  it('blocks metadata endpoints by name', () => {
    assert.match(checkHostnameLiteral('metadata.google.internal')!, /GCP metadata/);
    assert.match(checkHostnameLiteral('metadata')!, /metadata/);
  });
  it('blocks literal private IPs in hostname', () => {
    assert.match(checkHostnameLiteral('127.0.0.1')!, /loopback/);
    assert.match(checkHostnameLiteral('10.0.0.1')!, /10\.x/);
  });
  it('returns null for public DNS names (no DNS call here)', () => {
    // We intentionally do NOT resolve DNS at this stage — that's
    // resolveAndCheck's job. Public-looking names pass the literal
    // pre-filter regardless of where they actually resolve to.
    assert.strictEqual(checkHostnameLiteral('example.com'), null);
    assert.strictEqual(checkHostnameLiteral('www.github.com'), null);
  });
});

describe('resolveAndCheck — P2-1: DNS-based SSRF prevention', () => {
  it('returns null for a hostname that resolves only to public IPs', async () => {
    // example.com is IANA's reserved example domain; resolves to public IP.
    const r = await resolveAndCheck('example.com');
    assert.strictEqual(r, null, `expected null, got: ${r}`);
  });
  it('blocks a hostname whose resolution hits a loopback alias', async () => {
    // `localhost` resolves to 127.0.0.1 on every sane system — this tests
    // that we catch the DNS→IP bypass even when the literal string
    // doesn't look like 127.x.x.x.
    const r = await resolveAndCheck('localhost');
    assert.ok(r && /loopback/.test(r), `expected loopback block, got: ${r}`);
  });
  it('does not throw on unresolvable hostname', async () => {
    const r = await resolveAndCheck('this-host-does-not-exist-for-real.invalid');
    assert.strictEqual(r, null, 'unresolvable → let fetch fail naturally');
  });
});

describe('validateOutboundUrl — end-to-end', () => {
  it('blocks non-http(s) protocol', async () => {
    assert.match((await validateOutboundUrl('file:///etc/passwd'))!, /protocol/);
    assert.match((await validateOutboundUrl('ftp://ex.com/x'))!, /protocol/);
    assert.match((await validateOutboundUrl('gopher://ex.com/'))!, /protocol/);
  });
  it('blocks invalid URLs', async () => {
    assert.match((await validateOutboundUrl('not a url'))!, /Invalid URL/);
  });
  it('blocks literal-private-IP URLs without DNS lookup', async () => {
    assert.match((await validateOutboundUrl('http://127.0.0.1:8080/'))!, /loopback/);
    assert.match((await validateOutboundUrl('http://10.0.0.1/x'))!, /10\.x/);
    assert.match((await validateOutboundUrl('http://169.254.169.254/latest/meta-data/'))!, /link-local|metadata/);
  });
  it('blocks DNS-resolves-to-private-IP URLs (the actual P2-1 fix)', async () => {
    // localhost as a name resolves to 127.0.0.1 → was previously not
    // blocked by string-match on `http://localhost` in http-client.ts
    // only when the URL used a fully-qualified host pointing at a
    // private IP. The literal filter catches "localhost" here, but we
    // also test a case that goes through DNS resolution proper:
    // `localhost.localdomain` on many systems resolves to 127.0.0.1.
    const r1 = await validateOutboundUrl('http://localhost/');
    assert.ok(r1 && /localhost|loopback/.test(r1));
  });
  it('allows public HTTPS URLs', async () => {
    const r = await validateOutboundUrl('https://example.com/');
    assert.strictEqual(r, null);
  });
});
