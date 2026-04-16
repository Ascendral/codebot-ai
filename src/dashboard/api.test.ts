import { describe, it, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { DashboardServer } from './server';
import { registerApiRoutes } from './api';

function request(url: string, method: string = 'GET', token?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = http.request(url, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode || 0,
          body: Buffer.concat(chunks).toString('utf-8'),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

let portCounter = 14120;
function nextPort(): number {
  return portCounter++;
}

describe('Dashboard API', () => {
  let server: DashboardServer | null = null;
  let tmpDir: string = '';

  afterEach(async () => {
    if (server && server.isRunning()) {
      await server.stop();
    }
    server = null;
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  function setupTestProject(): string {
    tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'api-test-'));
    const sessionsDir = path.join(tmpDir, '.codebot', 'sessions');
    const auditDir = path.join(tmpDir, '.codebot', 'audit');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.mkdirSync(auditDir, { recursive: true });

    // Create a test session
    fs.writeFileSync(
      path.join(sessionsDir, 'test-session-1.jsonl'),
      '{"role":"user","content":"hello"}\n{"role":"assistant","content":"hi there"}\n'
    );

    // Create a test audit log
    fs.writeFileSync(
      path.join(auditDir, 'test-session-1.jsonl'),
      '{"tool":"read_file","action":"execute","timestamp":"2025-01-01T00:00:00Z","hash":"abc"}\n{"tool":"write_file","action":"execute","timestamp":"2025-01-01T00:01:00Z","prevHash":"abc","hash":"def"}\n'
    );

    return tmpDir;
  }

  it('GET /api/health returns ok', async () => {
    const port = nextPort();
    server = new DashboardServer({ port });
    registerApiRoutes(server);
    await server.start();

    const res = await request(`http://127.0.0.1:${port}/api/health`, 'GET', server!.getAuthToken());
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, 'ok');
    assert.ok(body.version);
    assert.ok(typeof body.uptime === 'number');
  });

  it('GET /api/sessions returns session list', async () => {
    const port = nextPort();
    const root = setupTestProject();
    server = new DashboardServer({ port });
    registerApiRoutes(server, root);
    await server.start();

    const res = await request(`http://127.0.0.1:${port}/api/sessions`, 'GET', server!.getAuthToken());
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.sessions));
    assert.ok(typeof body.total === 'number');
    assert.ok(body.total >= 0);
    if (body.sessions.length > 0) {
      assert.ok(body.sessions[0].id);
      assert.ok(typeof body.sessions[0].messageCount === 'number');
    }
  });

  it('GET /api/sessions/:id returns session detail', async () => {
    const port = nextPort();
    const root = setupTestProject();
    server = new DashboardServer({ port });
    registerApiRoutes(server, root);
    await server.start();

    const listRes = await request(`http://127.0.0.1:${port}/api/sessions?limit=1`, 'GET', server!.getAuthToken());
    const listBody = JSON.parse(listRes.body);
    if (listBody.sessions.length === 0) return;

    const sessionId = listBody.sessions[0].id;
    const res = await request(`http://127.0.0.1:${port}/api/sessions/${sessionId}`, 'GET', server!.getAuthToken());
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.id, sessionId);
    assert.ok(typeof body.messageCount === 'number');
    assert.ok(Array.isArray(body.messages));
  });

  it('GET /api/sessions/:id returns 404 for missing session', async () => {
    const port = nextPort();
    const root = setupTestProject();
    server = new DashboardServer({ port });
    registerApiRoutes(server, root);
    await server.start();

    const res = await request(`http://127.0.0.1:${port}/api/sessions/nonexistent`, 'GET', server!.getAuthToken());
    assert.strictEqual(res.status, 404);
  });

  it('GET /api/audit returns audit entries', async () => {
    const port = nextPort();
    const root = setupTestProject();
    server = new DashboardServer({ port });
    registerApiRoutes(server, root);
    await server.start();

    const res = await request(`http://127.0.0.1:${port}/api/audit?days=365`, 'GET', server!.getAuthToken());
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.entries));
    assert.ok(body.total >= 0);
  });

  it('GET /api/audit/verify returns chain integrity', async () => {
    const port = nextPort();
    const root = setupTestProject();
    server = new DashboardServer({ port });
    registerApiRoutes(server, root);
    await server.start();

    const res = await request(`http://127.0.0.1:${port}/api/audit/verify`, 'GET', server!.getAuthToken());
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.chainIntegrity === 'verified' || body.chainIntegrity === 'broken');
  });

  it('GET /api/metrics/summary returns aggregated stats', async () => {
    const port = nextPort();
    const root = setupTestProject();
    server = new DashboardServer({ port });
    registerApiRoutes(server, root);
    await server.start();

    const res = await request(`http://127.0.0.1:${port}/api/metrics/summary`, 'GET', server!.getAuthToken());
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.ok(typeof body.sessions === 'number');
    assert.ok(typeof body.auditEntries === 'number');
  });

  it('GET /api/usage returns usage history', async () => {
    const port = nextPort();
    const root = setupTestProject();
    server = new DashboardServer({ port });
    registerApiRoutes(server, root);
    await server.start();

    const res = await request(`http://127.0.0.1:${port}/api/usage`, 'GET', server!.getAuthToken());
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.usage));
  });

  it('POST /api/audit/export returns entries', async () => {
    const port = nextPort();
    const root = setupTestProject();
    server = new DashboardServer({ port });
    registerApiRoutes(server, root);
    await server.start();

    const res = await request(`http://127.0.0.1:${port}/api/audit/export`, 'POST', server!.getAuthToken());
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.format);
    assert.ok(body.version);
  });

  it('handles empty project directory gracefully', async () => {
    const port = nextPort();
    tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'api-empty-'));
    server = new DashboardServer({ port });
    registerApiRoutes(server, tmpDir);
    await server.start();

    const res = await request(`http://127.0.0.1:${port}/api/sessions`, 'GET', server!.getAuthToken());
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.ok(typeof body.total === 'number');
    assert.ok(Array.isArray(body.sessions));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug #10: POST /api/setup/provider reconciles provider against the model's
// declared provider. Without this, the dashboard would write
// `{provider: openai, model: claude-sonnet-4-6}` and every subsequent chat
// would 404 at the OpenAI endpoint.
// ─────────────────────────────────────────────────────────────────────────────
function postJson(
  url: string,
  body: unknown,
  token?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = http.request(url, { method: 'POST', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode || 0,
          body: Buffer.concat(chunks).toString('utf-8'),
        });
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

describe('POST /api/setup/provider — bug #10 provider reconciliation', () => {
  let server: DashboardServer | null = null;
  let codebotHomeBackup: string | undefined;
  let tmpHome: string = '';

  async function startServer(): Promise<number> {
    const port = portCounter++;
    tmpHome = fs.mkdtempSync(path.join(require('os').tmpdir(), 'api-bug10-'));
    codebotHomeBackup = process.env.CODEBOT_HOME;
    process.env.CODEBOT_HOME = tmpHome;
    server = new DashboardServer({ port });
    registerApiRoutes(server);
    await server.start();
    return port;
  }

  afterEach(async () => {
    if (server && server.isRunning()) await server.stop();
    server = null;
    if (codebotHomeBackup === undefined) delete process.env.CODEBOT_HOME;
    else process.env.CODEBOT_HOME = codebotHomeBackup;
    if (tmpHome && fs.existsSync(tmpHome)) fs.rmSync(tmpHome, { recursive: true });
  });

  function readSavedConfig(): Record<string, unknown> {
    const cfg = path.join(tmpHome, 'config.json');
    return JSON.parse(fs.readFileSync(cfg, 'utf-8'));
  }

  it('auto-corrects provider when a Claude model is sent with provider=openai', async () => {
    const port = await startServer();
    const res = await postJson(
      `http://127.0.0.1:${port}/api/setup/provider`,
      { provider: 'openai', model: 'claude-sonnet-4-6' },
      server!.getAuthToken(),
    );
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.provider, 'anthropic');
    assert.strictEqual(body.providerCorrectedFrom, 'openai');
    assert.match(body.note, /openai.*anthropic.*claude-sonnet-4-6/);
    const saved = readSavedConfig();
    assert.strictEqual(saved.provider, 'anthropic');
    assert.strictEqual(saved.model, 'claude-sonnet-4-6');
  });

  it('auto-corrects provider when a gpt-5 model is sent with provider=anthropic', async () => {
    const port = await startServer();
    const res = await postJson(
      `http://127.0.0.1:${port}/api/setup/provider`,
      { provider: 'anthropic', model: 'gpt-5.4' },
      server!.getAuthToken(),
    );
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.provider, 'openai');
    assert.strictEqual(body.providerCorrectedFrom, 'anthropic');
    const saved = readSavedConfig();
    assert.strictEqual(saved.provider, 'openai');
  });

  it('leaves provider alone when model matches', async () => {
    const port = await startServer();
    const res = await postJson(
      `http://127.0.0.1:${port}/api/setup/provider`,
      { provider: 'openai', model: 'gpt-4o' },
      server!.getAuthToken(),
    );
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.provider, 'openai');
    assert.strictEqual(body.providerCorrectedFrom, undefined);
    assert.strictEqual(body.note, undefined);
  });

  it('leaves provider alone for unknown/local models (no detection)', async () => {
    const port = await startServer();
    const res = await postJson(
      `http://127.0.0.1:${port}/api/setup/provider`,
      { provider: 'openai', model: 'my-custom-local-model:latest' },
      server!.getAuthToken(),
    );
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.provider, 'openai');
    assert.strictEqual(body.providerCorrectedFrom, undefined);
  });

  it('leaves provider alone when no model is sent', async () => {
    const port = await startServer();
    const res = await postJson(
      `http://127.0.0.1:${port}/api/setup/provider`,
      { provider: 'openai' },
      server!.getAuthToken(),
    );
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.provider, 'openai');
    assert.strictEqual(body.providerCorrectedFrom, undefined);
  });

  it('reconciliation + normalizeProviderBaseUrl together: openai→anthropic rewrites baseUrl', async () => {
    const port = await startServer();
    // Pre-populate config with OpenAI baseUrl
    fs.mkdirSync(tmpHome, { recursive: true });
    fs.writeFileSync(
      path.join(tmpHome, 'config.json'),
      JSON.stringify({ provider: 'openai', baseUrl: 'https://api.openai.com' }),
    );
    const res = await postJson(
      `http://127.0.0.1:${port}/api/setup/provider`,
      { provider: 'openai', model: 'claude-sonnet-4-6' },
      server!.getAuthToken(),
    );
    assert.strictEqual(res.status, 200);
    const saved = readSavedConfig();
    assert.strictEqual(saved.provider, 'anthropic');
    assert.strictEqual(saved.baseUrl, 'https://api.anthropic.com');
  });
});
