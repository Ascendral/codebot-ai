import { describe, it, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DashboardServer } from './server';
import { registerCommandRoutes } from './command-api';
import { Agent } from '../agent';
import type { LLMProvider, AgentEvent } from '../types';

/**
 * Acceptance tests for the POST /api/command/tool/run bypass fix
 * (2026-04-23 SECURITY).
 *
 * Before this fix the endpoint called `tool.execute(body.args)` directly
 * on the ToolRegistry entry — bypassing schema validation, policy
 * allow-list, risk scoring, ConstitutionalLayer, SPARK, permission
 * prompts, and AuditLogger. A dashboard-token holder could run any
 * registered tool with zero security gates and zero audit trail.
 *
 * These tests prove:
 *   1. A call that requires a permission prompt (e.g. `execute`, whose
 *      default permission is `prompt`) is denied with `blocked: true`
 *      and a matching audit entry is written — there's no user on an
 *      HTTP wire to answer a readline prompt, so we fail closed.
 *   2. An `auto`-permission tool (e.g. `read_file`) still runs through
 *      the endpoint successfully, so the fix doesn't break the legit
 *      dashboard UX.
 */

function request(
  url: string,
  method: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const req = http.request(url, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode || 0,
        body: Buffer.concat(chunks).toString('utf-8'),
      }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

function makeStubProvider(): LLMProvider {
  return {
    name: 'stub',
    async *chat(): AsyncGenerator<AgentEvent> {
      yield { type: 'done' };
    },
  } as LLMProvider;
}

let portCounter = 15620;
function nextPort(): number { return portCounter++; }

describe('POST /api/command/tool/run — security gate chain', () => {
  let server: DashboardServer | null = null;
  let agent: Agent | null = null;
  let fixtureDir: string | null = null;

  afterEach(async () => {
    if (server && server.isRunning()) await server.stop();
    server = null;
    if (fixtureDir && fs.existsSync(fixtureDir)) {
      try { fs.rmSync(fixtureDir, { recursive: true }); } catch { /* ignore */ }
    }
    fixtureDir = null;
    agent = null;
  });

  async function startServer(): Promise<{ port: number; token: string }> {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-test-tool-run-'));
    // A readable fixture file for the read_file happy-path test
    fs.writeFileSync(path.join(fixtureDir, 'hello.txt'), 'hello from fixture\n');

    // Match real dashboard usage: autoApprove=true. CORD issues CHALLENGE
    // for almost every action by design (it wants a human on the prompt),
    // so without autoApprove the dashboard would fail-closed on harmless
    // tools too. autoApprove skips the permission gate for CHALLENGE but
    // NOT for CORD BLOCK / SPARK CHALLENGE / policy / capability — the
    // layers this test actually cares about.
    agent = new Agent({
      provider: makeStubProvider(),
      model: 'stub-model',
      providerName: 'stub',
      projectRoot: fixtureDir,
      autoApprove: true,
    });

    const port = nextPort();
    server = new DashboardServer({ port });
    registerCommandRoutes(server, agent);
    await server.start();
    return { port, token: server.getAuthToken() };
  }

  it('blocks a dangerous `execute` call and writes an audit entry', async () => {
    const { port, token } = await startServer();
    const sessionId = agent!.getAuditLogger().getSessionId();

    const res = await request(
      `http://127.0.0.1:${port}/api/command/tool/run`,
      'POST',
      token,
      { tool: 'execute', args: { command: 'rm -rf /' } },
    );

    // Endpoint responds 200 with structured block outcome — NOT 500,
    // NOT a successful execution.
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${res.body}`);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.is_error, true, `expected is_error: true, got body=${JSON.stringify(body)}`);
    assert.strictEqual(body.blocked, true, `expected blocked: true, got body=${JSON.stringify(body)}`);
    // Result should be the safety-policy message, not shell output.
    assert.ok(
      /blocked|policy|permission/i.test(String(body.result)),
      `expected block message in result, got: ${body.result}`,
    );

    // An audit entry MUST exist for this session tagged with a
    // deny/block action. This is the whole point of the fix — the old
    // code path wrote nothing.
    const entries = agent!.getAuditLogger().query({ sessionId });
    const blockEntries = entries.filter(e =>
      e.tool === 'execute' &&
      (e.action === 'deny' ||
       e.action === 'constitutional_block' ||
       e.action === 'policy_block' ||
       e.action === 'security_block'),
    );
    assert.ok(
      blockEntries.length > 0,
      `expected ≥1 block audit entry for execute, got entries=${JSON.stringify(entries.map(e => ({ tool: e.tool, action: e.action })))}`,
    );
  });

  it('allows a safe `read_file` call to pass through', async () => {
    const { port, token } = await startServer();

    const target = path.join(fixtureDir!, 'hello.txt');
    const res = await request(
      `http://127.0.0.1:${port}/api/command/tool/run`,
      'POST',
      token,
      { tool: 'read_file', args: { path: target } },
    );

    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${res.body}`);
    const body = JSON.parse(res.body);
    assert.strictEqual(
      body.blocked,
      false,
      `expected blocked: false for read_file, got body=${JSON.stringify(body)}`,
    );
    assert.strictEqual(
      body.is_error,
      false,
      `expected is_error: false for read_file, got body=${JSON.stringify(body)}`,
    );
    assert.ok(
      String(body.result).includes('hello from fixture'),
      `expected file contents in result, got: ${body.result}`,
    );
  });

  it('returns 404 for an unknown tool (preserves pre-fix shape)', async () => {
    const { port, token } = await startServer();
    const res = await request(
      `http://127.0.0.1:${port}/api/command/tool/run`,
      'POST',
      token,
      { tool: 'no_such_tool_exists', args: {} },
    );
    assert.strictEqual(res.status, 404, `expected 404, got ${res.status}: ${res.body}`);
  });
});
