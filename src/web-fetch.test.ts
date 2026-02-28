import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { WebFetchTool } from './tools/web-fetch';

describe('WebFetchTool SSRF protection', () => {
  const tool = new WebFetchTool();

  // Helper to test URL validation via execute (which calls validateUrl internally)
  async function testUrl(url: string): Promise<string> {
    return tool.execute({ url });
  }

  it('blocks full loopback range (127.0.0.2)', async () => {
    const result = await testUrl('http://127.0.0.2/secret');
    assert.ok(result.includes('Blocked') || result.includes('loopback'), `Should block 127.0.0.2: ${result}`);
  });

  it('blocks 127.0.0.1', async () => {
    const result = await testUrl('http://127.0.0.1/admin');
    assert.ok(result.includes('Blocked') || result.includes('loopback'), `Should block 127.0.0.1: ${result}`);
  });

  it('blocks localhost', async () => {
    const result = await testUrl('http://localhost/admin');
    assert.ok(result.includes('Blocked'), `Should block localhost: ${result}`);
  });

  it('blocks IPv6 link-local (fe80::)', async () => {
    const result = await testUrl('http://[fe80::1]/secret');
    assert.ok(result.includes('Blocked') || result.includes('link-local'), `Should block fe80::: ${result}`);
  });

  it('blocks IPv6 unique local (fc00::)', async () => {
    const result = await testUrl('http://[fc00::1]/secret');
    assert.ok(result.includes('Blocked') || result.includes('unique local'), `Should block fc00::: ${result}`);
  });

  it('blocks IPv6 unique local (fd00::)', async () => {
    const result = await testUrl('http://[fd12::1]/secret');
    assert.ok(result.includes('Blocked') || result.includes('unique local'), `Should block fd12::: ${result}`);
  });

  it('blocks IPv6 multicast (ff02::)', async () => {
    const result = await testUrl('http://[ff02::1]/secret');
    assert.ok(result.includes('Blocked') || result.includes('multicast'), `Should block ff02::: ${result}`);
  });

  it('blocks cloud metadata endpoint', async () => {
    const result = await testUrl('http://169.254.169.254/latest/meta-data/');
    assert.ok(result.includes('Blocked'), `Should block metadata endpoint: ${result}`);
  });

  it('blocks private 10.x range', async () => {
    const result = await testUrl('http://10.0.0.1/internal');
    assert.ok(result.includes('Blocked'), `Should block 10.x: ${result}`);
  });

  it('blocks private 192.168.x range', async () => {
    const result = await testUrl('http://192.168.1.1/router');
    assert.ok(result.includes('Blocked'), `Should block 192.168.x: ${result}`);
  });

  it('blocks link-local IPv4 (169.254.x.x)', async () => {
    const result = await testUrl('http://169.254.1.1/secret');
    assert.ok(result.includes('Blocked'), `Should block 169.254.x.x: ${result}`);
  });

  it('blocks file:// protocol', async () => {
    const result = await testUrl('file:///etc/passwd');
    assert.ok(result.includes('Blocked') || result.includes('protocol'), `Should block file://: ${result}`);
  });

  it('allows normal HTTPS URLs', async () => {
    // This will fail to connect but should NOT be blocked by validation
    const result = await testUrl('https://example.com');
    assert.ok(!result.includes('Blocked'), `Should not block example.com: ${result.substring(0, 100)}`);
  });
});
