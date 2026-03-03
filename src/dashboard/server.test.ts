import { describe, it, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { DashboardServer } from './server';

// Helper to make HTTP requests
function request(url: string, method: string = 'GET', body?: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode || 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf-8'),
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Use a port range to avoid conflicts
let portCounter = 13120;
function nextPort(): number {
  return portCounter++;
}

describe('DashboardServer', () => {
  let server: DashboardServer | null = null;

  afterEach(async () => {
    if (server && server.isRunning()) {
      await server.stop();
    }
    server = null;
  });

  it('starts and stops cleanly', async () => {
    const port = nextPort();
    server = new DashboardServer({ port });
    const info = await server.start();
    assert.strictEqual(info.port, port);
    assert.ok(info.url.includes(String(port)));
    assert.strictEqual(server.isRunning(), true);
    await server.stop();
    assert.strictEqual(server.isRunning(), false);
  });

  it('returns 404 for unknown routes', async () => {
    const port = nextPort();
    server = new DashboardServer({ port });
    await server.start();
    const res = await request(`http://127.0.0.1:${port}/nonexistent`);
    assert.strictEqual(res.status, 404);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.error, 'Not Found');
  });

  it('handles registered routes', async () => {
    const port = nextPort();
    server = new DashboardServer({ port });
    server.route('GET', '/api/health', (_req, res) => {
      DashboardServer.json(res, { status: 'ok' });
    });
    await server.start();
    const res = await request(`http://127.0.0.1:${port}/api/health`);
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, 'ok');
  });

  it('supports route parameters', async () => {
    const port = nextPort();
    server = new DashboardServer({ port });
    server.route('GET', '/api/sessions/:id', (_req, res, params) => {
      DashboardServer.json(res, { sessionId: params.id });
    });
    await server.start();
    const res = await request(`http://127.0.0.1:${port}/api/sessions/abc123`);
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.sessionId, 'abc123');
  });

  it('handles CORS preflight', async () => {
    const port = nextPort();
    server = new DashboardServer({ port });
    await server.start();
    const res = await request(`http://127.0.0.1:${port}/api/anything`, 'OPTIONS');
    assert.strictEqual(res.status, 204);
    assert.ok(res.headers['access-control-allow-origin']);
  });

  it('serves static files', async () => {
    const port = nextPort();
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dash-test-'));
    fs.writeFileSync(path.join(tmpDir, 'index.html'), '<h1>Test</h1>');
    fs.writeFileSync(path.join(tmpDir, 'style.css'), 'body { color: red; }');

    server = new DashboardServer({ port, staticDir: tmpDir });
    await server.start();

    const htmlRes = await request(`http://127.0.0.1:${port}/`);
    assert.strictEqual(htmlRes.status, 200);
    assert.ok(htmlRes.headers['content-type']?.includes('text/html'));
    assert.ok(htmlRes.body.includes('<h1>Test</h1>'));

    const cssRes = await request(`http://127.0.0.1:${port}/style.css`);
    assert.strictEqual(cssRes.status, 200);
    assert.ok(cssRes.headers['content-type']?.includes('text/css'));

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('json helper sends correct headers', async () => {
    const port = nextPort();
    server = new DashboardServer({ port });
    server.route('GET', '/test', (_req, res) => {
      DashboardServer.json(res, { hello: 'world' }, 201);
    });
    await server.start();
    const res = await request(`http://127.0.0.1:${port}/test`);
    assert.strictEqual(res.status, 201);
    assert.ok(res.headers['content-type']?.includes('application/json'));
    assert.ok(res.headers['access-control-allow-origin']);
  });

  it('parseQuery extracts parameters', () => {
    const params = DashboardServer.parseQuery('/api/test?foo=bar&baz=42');
    assert.strictEqual(params.foo, 'bar');
    assert.strictEqual(params.baz, '42');
  });

  it('parseQuery handles empty query', () => {
    const params = DashboardServer.parseQuery('/api/test');
    assert.deepStrictEqual(params, {});
  });

  it('prevents directory traversal in static serving', async () => {
    const port = nextPort();
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dash-test-'));
    fs.writeFileSync(path.join(tmpDir, 'index.html'), 'ok');

    server = new DashboardServer({ port, staticDir: tmpDir });
    await server.start();

    const res = await request(`http://127.0.0.1:${port}/../../../etc/passwd`);
    assert.strictEqual(res.status, 404);

    fs.rmSync(tmpDir, { recursive: true });
  });
});
