/**
 * PR 13 — regression tests for /api/audit/verify and /api/risk/summary
 * after the dashboard rewrite (live-battery bugs A and B).
 *
 * Bug A (now fixed in src/dashboard/api.ts:429): the old
 * /api/audit/verify walked entries linearly across ALL sessions,
 * comparing entries[i].prevHash against entries[i-1].hash. prevHash
 * only chains within a session, so every session boundary registered
 * as a "broken" link. On a healthy log with N sessions we'd see
 * roughly N-1 spurious invalids and `chainIntegrity: "broken"`.
 *
 * Bug B (now fixed in src/dashboard/api.ts:580): /api/risk/summary
 * read `server._riskScorer` — a field nothing in the codebase ever
 * assigned. The handler always returned zeros + a misleading message.
 * The fix aggregates from the audit log directly, with an explicit
 * `coverage` field announcing the metric only counts rows where the
 * agent emitted `result: "risk:N"` (score > 50).
 *
 * These tests build a synthetic audit directory and exercise the
 * handlers via the registered routes — no real network, no real Agent.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { DashboardServer } from './server';
import { registerApiRoutes } from './api';
import { AuditLogger } from '../audit';

/** Build a real hash-chained session by running entries through AuditLogger.
 *  Each call constructs a fresh AuditLogger, which auto-generates a unique
 *  sessionId — so each call to this helper produces a distinct session in
 *  the same on-disk file. Returns the sessionId so the test can assert on it. */
function appendSessionToLog(auditDir: string, entries: Array<{ tool: string; action: string; args?: Record<string, unknown>; result?: string; reason?: string }>): string {
  const logger = new AuditLogger(auditDir);
  for (const e of entries) {
    logger.log({
      tool: e.tool,
      action: e.action as 'execute',
      args: e.args || {},
      result: e.result,
      reason: e.reason,
    });
  }
  return logger.getSessionId();
}

/** Append a corrupted line whose `hash` does NOT match its content. */
function appendCorruptSessionToLog(auditDir: string, sessionId: string): void {
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(auditDir, `audit-${day}.jsonl`);
  const corrupt = {
    timestamp: new Date().toISOString(),
    sessionId,
    sequence: 1,
    tool: 'execute',
    action: 'execute',
    args: { command: 'tampered' },
    prevHash: 'genesis',
    hash: 'deadbeef'.repeat(8), // deliberately wrong
  };
  fs.appendFileSync(file, JSON.stringify(corrupt) + '\n');
}

/** Use the server's auth-bypass via Bearer header — read the token off the instance. */
function authedCall(server: DashboardServer, method: string, urlPath: string): Promise<any> {
  const token = (server as any).authToken;
  return new Promise((resolve, reject) => {
    const http = require('node:http');
    const port = (server as any).server?.address()?.port;
    if (!port) return reject(new Error('server not listening'));
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers: { Authorization: `Bearer ${token}` } }, (res: any) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, body }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('Dashboard API — PR 13 regression tests', () => {
  it('/api/audit/verify — multi-session healthy log returns chainIntegrity:"verified"', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codebot-pr13-'));
    const auditDir = path.join(tmp, 'audit');
    fs.mkdirSync(auditDir, { recursive: true });

    // Three independent sessions, each hash-chained internally.
    appendSessionToLog(auditDir, [
      { tool: 'read_file', action: 'execute', args: { path: 'a.ts' } },
      { tool: 'read_file', action: 'execute', args: { path: 'b.ts' } },
    ]);
    appendSessionToLog(auditDir, [
      { tool: 'execute', action: 'execute', args: { command: 'ls' } },
    ]);
    appendSessionToLog(auditDir, [
      { tool: 'app', action: 'execute', args: { action: 'github.list_prs' } },
      { tool: 'app', action: 'execute', args: { action: 'github.list_prs' } },
      { tool: 'app', action: 'execute', args: { action: 'github.list_prs' } },
    ]);

    // Override codebotPath for the test by setting CODEBOT_HOME.
    const prevHome = process.env.CODEBOT_HOME;
    process.env.CODEBOT_HOME = tmp;
    try {
      const server = new DashboardServer({ port: 0 });
      registerApiRoutes(server);
      await server.start();
      try {
        const r = await authedCall(server, 'GET', '/api/audit/verify');
        assert.strictEqual(r.status, 200, `status=${r.status} body=${JSON.stringify(r.body)}`);
        assert.strictEqual(r.body.totalSessions, 3, `expected 3 sessions, saw ${r.body.totalSessions}`);
        assert.strictEqual(r.body.totalEntries, 6, `expected 6 entries, saw ${r.body.totalEntries}`);
        assert.strictEqual(r.body.sessionsVerified, 3,
          `all sessions should verify; saw verified=${r.body.sessionsVerified} invalid=${r.body.sessionsInvalid} legacy=${r.body.sessionsLegacy}`);
        assert.strictEqual(r.body.sessionsInvalid, 0);
        assert.strictEqual(r.body.chainIntegrity, 'verified');
      } finally {
        await server.stop();
      }
    } finally {
      if (prevHome === undefined) delete process.env.CODEBOT_HOME;
      else process.env.CODEBOT_HOME = prevHome;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('/api/audit/verify — corrupted session reports invalid + names the session', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codebot-pr13-'));
    const auditDir = path.join(tmp, 'audit');
    fs.mkdirSync(auditDir, { recursive: true });

    appendSessionToLog(auditDir, [
      { tool: 'read_file', action: 'execute', args: { path: 'x' } },
    ]);
    appendCorruptSessionToLog(auditDir, 'sess-tampered');

    const prevHome = process.env.CODEBOT_HOME;
    process.env.CODEBOT_HOME = tmp;
    try {
      const server = new DashboardServer({ port: 0 });
      registerApiRoutes(server);
      await server.start();
      try {
        const r = await authedCall(server, 'GET', '/api/audit/verify');
        assert.strictEqual(r.body.sessionsInvalid, 1);
        assert.strictEqual(r.body.sessionsVerified, 1);
        assert.strictEqual(r.body.chainIntegrity, 'broken');
        assert.ok(Array.isArray(r.body.invalidDetail));
        const detail = r.body.invalidDetail.find((d: any) => d.sessionId === 'sess-tampered');
        assert.ok(detail, 'invalidDetail must name the corrupted session');
      } finally {
        await server.stop();
      }
    } finally {
      if (prevHome === undefined) delete process.env.CODEBOT_HOME;
      else process.env.CODEBOT_HOME = prevHome;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('/api/risk/summary — reflects audit-emitted risk rows (score > 50)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codebot-pr13-'));
    const auditDir = path.join(tmp, 'audit');
    fs.mkdirSync(auditDir, { recursive: true });

    // Risk rows are emitted with action='execute' and result='risk:N'.
    // Mix of orange (score 60), red (score 90), and a non-risk row.
    appendSessionToLog(auditDir, [
      { tool: 'execute', action: 'execute', args: { command: 'rm -rf foo' }, result: 'risk:60', reason: 'cumulative=20' },
      { tool: 'execute', action: 'execute', args: { command: 'curl bad.example' }, result: 'risk:90', reason: 'cumulative=40' },
      { tool: 'read_file', action: 'execute', args: { path: 'safe.ts' } }, // no risk row
    ]);

    const prevHome = process.env.CODEBOT_HOME;
    process.env.CODEBOT_HOME = tmp;
    try {
      const server = new DashboardServer({ port: 0 });
      registerApiRoutes(server);
      await server.start();
      try {
        const r = await authedCall(server, 'GET', '/api/risk/summary');
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.total, 2, `expected 2 risk samples, saw ${r.body.total}`);
        assert.strictEqual(r.body.orange, 1);
        assert.strictEqual(r.body.red, 1);
        assert.strictEqual(r.body.peak, 90);
        assert.strictEqual(r.body.average, 75);
        assert.strictEqual(r.body.source, 'audit-log');
        assert.match(r.body.coverage, /high-risk slice/);
      } finally {
        await server.stop();
      }
    } finally {
      if (prevHome === undefined) delete process.env.CODEBOT_HOME;
      else process.env.CODEBOT_HOME = prevHome;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('/api/risk/summary — empty audit log returns zeros, NOT the dead-code message', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codebot-pr13-'));
    const auditDir = path.join(tmp, 'audit');
    fs.mkdirSync(auditDir, { recursive: true });

    const prevHome = process.env.CODEBOT_HOME;
    process.env.CODEBOT_HOME = tmp;
    try {
      const server = new DashboardServer({ port: 0 });
      registerApiRoutes(server);
      await server.start();
      try {
        const r = await authedCall(server, 'GET', '/api/risk/summary');
        assert.strictEqual(r.body.total, 0);
        // Crucially: no `message: 'No risk data yet. Risk scoring activates...'`.
        // That was the dead-code branch from the orphaned _riskScorer path.
        assert.ok(!('message' in r.body) || !/Risk scoring activates/.test(r.body.message),
          `must not return the orphaned-scorer message; got ${JSON.stringify(r.body)}`);
        assert.strictEqual(r.body.source, 'audit-log');
      } finally {
        await server.stop();
      }
    } finally {
      if (prevHome === undefined) delete process.env.CODEBOT_HOME;
      else process.env.CODEBOT_HOME = prevHome;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
