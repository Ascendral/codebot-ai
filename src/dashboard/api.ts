/**
 * CodeBot AI — Dashboard REST API
 *
 * Registers API routes on the DashboardServer for the web frontend.
 * Reads from the file-based session/audit storage.
 *
 * ZERO external dependencies — uses only Node.js built-in modules.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DashboardServer } from './server';
import { VERSION } from '../index';
import { PROVIDER_DEFAULTS, MODEL_REGISTRY, detectProvider } from '../providers/registry';
import { SessionManager } from '../history';
import { decryptLine } from '../encryption';
import { UserProfile } from '../user-profile';
import { MemoryManager } from '../memory';
import { loadConfig, saveConfig as saveSetupConfig, isFirstRun, detectLocalServers, SavedConfig, isProviderDisabled, pickProviderKey } from '../setup';
import { codebotPath } from '../paths';
import { AuditLogger, AuditEntry } from '../audit';

// Previously: detectAvailableProviders() — superseded by the inline
// availability loop at /api/models/registry, which is the only caller
// that ever needed provider availability. Removing dead code to keep
// the module honest.

/** Register all API routes on the server */
export function registerApiRoutes(server: DashboardServer, projectRoot?: string): void {
  const root = projectRoot || process.cwd();
  const startTime = Date.now();

  // ── Health ──
  server.route('GET', '/api/health', (_req, res) => {
    DashboardServer.json(res, {
      status: 'ok',
      version: VERSION,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      timestamp: new Date().toISOString(),
    });
  });

  // ── Sessions ──
  server.route('GET', '/api/sessions', (req, res) => {
    const query = DashboardServer.parseQuery(req.url || '');
    const page = Math.max(1, parseInt(query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || '20', 10)));
    const searchTerm = (query.q || '').toLowerCase();

    let sessions = SessionManager.list(100);

    if (searchTerm) {
      sessions = sessions.filter(s =>
        s.preview.toLowerCase().includes(searchTerm) ||
        s.id.includes(searchTerm) ||
        s.model.toLowerCase().includes(searchTerm)
      );
    }

    const start = (page - 1) * limit;
    const paginated = sessions.slice(start, start + limit);

    const items = paginated.map(s => ({
      id: s.id,
      preview: s.preview,
      model: s.model,
      messageCount: s.messageCount,
      createdAt: s.created || null,
      modifiedAt: s.updated || null,
    }));

    DashboardServer.json(res, {
      sessions: items,
      total: sessions.length,
      page,
      limit,
      hasMore: start + limit < sessions.length,
    });
  });

  server.route('GET', '/api/sessions/:id', (_req, res, params) => {
    const sessionsDir = codebotPath('sessions');
    const sessionFile = path.join(sessionsDir, `${params.id}.jsonl`);
    if (!fs.existsSync(sessionFile)) {
      DashboardServer.error(res, 404, 'Session not found');
      return;
    }

    let lines: string[];
    try {
      lines = fs.readFileSync(sessionFile, 'utf-8').split('\n').filter(Boolean);
    } catch (err: any) {
      DashboardServer.error(res, 500, 'Failed to read session: ' + (err.message || 'unknown'));
      return;
    }
    const messages = lines.map(line => {
      try {
        const decrypted = decryptLine(line);
        const obj = JSON.parse(decrypted);
        delete obj._ts;
        delete obj._model;
        delete obj._sig;
        return obj;
      } catch { return null; }
    }).filter(Boolean);

    const toolCalls = messages.filter((m: any) => m.role === 'assistant' && m.tool_calls?.length > 0);
    const stat = safeStatSync(sessionFile);

    const firstUserMsg = messages.find((m: any) => m.role === 'user');
    const preview = firstUserMsg ? String(firstUserMsg.content || '').substring(0, 120) : '';

    DashboardServer.json(res, {
      id: params.id,
      preview,
      messageCount: messages.length,
      toolCallCount: toolCalls.length,
      messages: messages.slice(-200),
      createdAt: stat?.birthtime?.toISOString() || null,
      modifiedAt: stat?.mtime?.toISOString() || null,
    });
  });

  // ── Delete Session ──
  server.route('DELETE', '/api/sessions/:id', (_req, res, params) => {
    const sessionsDir = codebotPath('sessions');
    const sessionFile = path.join(sessionsDir, `${params.id}.jsonl`);
    if (!fs.existsSync(sessionFile)) {
      DashboardServer.error(res, 404, 'Session not found');
      return;
    }

    try {
      fs.unlinkSync(sessionFile);

      // Also remove corresponding audit log if it exists
      const auditFile = path.join(codebotPath('audit'), `${params.id}.jsonl`);
      if (fs.existsSync(auditFile)) {
        fs.unlinkSync(auditFile);
      }

      DashboardServer.json(res, { deleted: true, id: params.id });
    } catch (err: any) {
      DashboardServer.error(res, 500, 'Failed to delete session: ' + (err.message || 'unknown'));
    }
  });

  // ── Batch Delete Sessions ──
  server.route('POST', '/api/sessions/batch-delete', async (req, res) => {
    let parsed: any;
    try {
      parsed = await DashboardServer.parseBody(req);
    } catch (err: any) {
      DashboardServer.error(res, 400, err.message || 'Invalid JSON body');
      return;
    }

    const ids = parsed?.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      DashboardServer.error(res, 400, 'ids must be a non-empty array');
      return;
    }

    const sessionsDir = codebotPath('sessions');
    let deleted = 0;
    let failed = 0;

    for (const id of ids) {
      const sessionFile = path.join(sessionsDir, `${id}.jsonl`);
      try {
        if (fs.existsSync(sessionFile)) {
          fs.unlinkSync(sessionFile);
          const auditFile = path.join(codebotPath('audit'), `${id}.jsonl`);
          if (fs.existsSync(auditFile)) fs.unlinkSync(auditFile);
          deleted++;
        }
      } catch { failed++; }
    }

    DashboardServer.json(res, { deleted, failed, total: ids.length });
  });

  // ── Setup / Onboarding ──
  server.route('GET', '/api/setup/status', (_req, res) => {
    const config = loadConfig();
    DashboardServer.json(res, {
      configured: !isFirstRun(),
      firstRunComplete: !!config.firstRunComplete,
      provider: config.provider || null,
      model: config.model || null,
      hasApiKey: !!config.apiKey,
    });
  });

  server.route('GET', '/api/setup/detect', async (_req, res) => {
    // Detect available providers: env vars + local servers.
    // Respects saved.disabledProviders so banned providers never surface as
    // "available" in the onboarding flow.
    const savedCfg = loadConfig();
    const envProviders: string[] = [];
    for (const [name, info] of Object.entries(PROVIDER_DEFAULTS)) {
      if (isProviderDisabled(savedCfg, name)) continue;
      const envVal = process.env[info.envKey];
      if (envVal && envVal.length > 5) envProviders.push(name);
    }
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN && !isProviderDisabled(savedCfg, 'anthropic')) {
      envProviders.push('anthropic');
    }

    let localServers: Array<{ name: string; url: string; models: string[] }> = [];
    try {
      localServers = await detectLocalServers();
    } catch {}

    DashboardServer.json(res, { envProviders, localServers });
  });

  server.route('GET', '/api/models/registry', (_req, res) => {
    // Return all models grouped by provider, with env key availability
    const groups: Record<string, Array<{ model: string; tools: boolean; vision: boolean; context: number }>> = {};
    for (const [model, info] of Object.entries(MODEL_REGISTRY)) {
      const provider = info.provider || 'local';
      if (!groups[provider]) groups[provider] = [];
      groups[provider].push({
        model,
        tools: info.supportsToolCalling,
        vision: !!info.supportsVision,
        context: info.contextWindow,
      });
    }
    // Check which providers have API keys configured.
    // disabledProviders hard-bans a provider regardless of env vars or
    // saved keys — the dropdown will show it as unavailable and frontend
    // grays out its models.
    const config = loadConfig();
    const available: Record<string, boolean> = {};
    for (const [name, info] of Object.entries(PROVIDER_DEFAULTS)) {
      if (isProviderDisabled(config, name)) {
        available[name] = false;
        continue;
      }
      const hasEnv = !!(process.env[info.envKey] && process.env[info.envKey]!.length > 5);
      const hasSavedKey = !!pickProviderKey(config, name);
      available[name] = hasEnv || hasSavedKey;
    }
    DashboardServer.json(res, { groups, available, current: { provider: config.provider, model: config.model } });
  });

  server.route('POST', '/api/setup/provider', async (req, res) => {
    let body: { provider?: string; model?: string; apiKey?: string; baseUrl?: string };
    try {
      body = (await DashboardServer.parseBody(req)) as typeof body;
    } catch (err: any) {
      DashboardServer.error(res, 400, err.message || 'Invalid JSON body');
      return;
    }

    if (!body?.provider) {
      DashboardServer.error(res, 400, 'Missing provider');
      return;
    }

    // Bug #10: reconcile provider against the model's declared provider.
    // If the caller sends {provider: 'openai', model: 'claude-sonnet-4-6'}
    // the model is the authoritative choice (user picked it from the
    // dropdown) and the provider is wrong. Without this fix the server
    // writes the mismatch and every subsequent chat returns 404
    // ("Model not found: claude-sonnet-4-6" at the OpenAI endpoint).
    //
    // detectProvider() returns undefined for unknown/local models — in that
    // case we leave body.provider alone.
    let effectiveProvider = body.provider;
    let providerCorrectedFrom: string | undefined;
    if (body.model) {
      const fromModel = detectProvider(body.model);
      if (fromModel && fromModel !== body.provider) {
        providerCorrectedFrom = body.provider;
        effectiveProvider = fromModel;
      }
    }

    const config: SavedConfig = loadConfig();
    config.provider = effectiveProvider;
    if (body.model) config.model = body.model;
    if (body.apiKey) config.apiKey = body.apiKey;
    if (body.baseUrl) config.baseUrl = body.baseUrl;
    saveSetupConfig(config);

    const response: Record<string, unknown> = {
      saved: true,
      provider: config.provider,
      model: config.model,
    };
    if (providerCorrectedFrom) {
      response.providerCorrectedFrom = providerCorrectedFrom;
      response.note = `Provider auto-corrected from "${providerCorrectedFrom}" to "${effectiveProvider}" to match model "${body.model}".`;
    }
    DashboardServer.json(res, response);
  });

  server.route('POST', '/api/setup/complete', async (_req, res) => {
    const config: SavedConfig = loadConfig();
    config.firstRunComplete = true;
    saveSetupConfig(config);
    DashboardServer.json(res, { complete: true });
  });

  // ── User Profile ──
  const userProfile = new UserProfile();

  server.route('GET', '/api/profile', (_req, res) => {
    DashboardServer.json(res, { profile: userProfile.getData() });
  });

  server.route('POST', '/api/profile', async (req, res) => {
    let body: Record<string, unknown>;
    try {
      body = (await DashboardServer.parseBody(req)) as Record<string, unknown>;
    } catch (err: any) {
      DashboardServer.error(res, 400, err.message || 'Invalid JSON body');
      return;
    }

    if (body.preferences) {
      userProfile.updatePreferences(body.preferences as Record<string, string>);
    }

    DashboardServer.json(res, { updated: true, profile: userProfile.getData() });
  });

  // ── Memory ──
  const memoryManager = new MemoryManager(root);

  server.route('GET', '/api/memory', (_req, res) => {
    const files = memoryManager.list();
    DashboardServer.json(res, {
      files,
      global: memoryManager.readGlobal(),
      project: memoryManager.readProject(),
    });
  });

  server.route('GET', '/api/memory/:scope/:file', (_req, res, params) => {
    const scope = params.scope || '';
    const file = params.file || '';

    if (!scope || !file) {
      DashboardServer.error(res, 400, 'Missing scope or file');
      return;
    }

    const memDir = scope === 'project'
      ? path.join(root, '.codebot', 'memory')
      : codebotPath('memory');

    // Prevent path traversal
    const safeFile = path.basename(file.endsWith('.md') ? file : file + '.md');
    const filePath = path.join(memDir, safeFile);

    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        DashboardServer.json(res, { scope, file: safeFile, content });
      } else {
        DashboardServer.error(res, 404, 'Memory file not found');
      }
    } catch {
      DashboardServer.error(res, 500, 'Failed to read memory file');
    }
  });

  server.route('POST', '/api/memory/:scope/:file', async (req, res, params) => {
    const scope = params.scope || '';
    const file = params.file || '';

    if (!scope || !file) {
      DashboardServer.error(res, 400, 'Missing scope or file');
      return;
    }

    let body: { content?: string };
    try {
      body = (await DashboardServer.parseBody(req)) as typeof body;
    } catch (err: any) {
      DashboardServer.error(res, 400, err.message || 'Invalid JSON body');
      return;
    }

    if (typeof body?.content !== 'string') {
      DashboardServer.error(res, 400, 'Missing "content" field');
      return;
    }

    const memDir = scope === 'project'
      ? path.join(root, '.codebot', 'memory')
      : codebotPath('memory');

    fs.mkdirSync(memDir, { recursive: true });
    // Prevent path traversal
    const safeFile = path.basename(file.endsWith('.md') ? file : file + '.md');
    const filePath = path.join(memDir, safeFile);

    try {
      fs.writeFileSync(filePath, body.content);
      DashboardServer.json(res, { saved: true, scope, file: safeFile });
    } catch {
      DashboardServer.error(res, 500, 'Failed to write memory file');
    }
  });

  // ── Audit ──
  server.route('GET', '/api/audit', (req, res) => {
    const query = DashboardServer.parseQuery(req.url || '');
    const days = Math.max(1, parseInt(query.days || '7', 10));
    const cutoff = Date.now() - days * 86400 * 1000;

    const auditDir = codebotPath('audit');
    const entries = loadAuditEntries(auditDir, cutoff);

    DashboardServer.json(res, {
      entries: entries.slice(-500), // Last 500 entries
      total: entries.length,
      days,
    });
  });

  // NOTE: /api/audit/verify must be registered before /api/audit/:sessionId
  server.route('GET', '/api/audit/verify', (_req, res) => {
    const auditDir = codebotPath('audit');
    const entries = loadAuditEntries(auditDir, 0) as AuditEntry[];

    // Group by sessionId and verify each session independently. The hash
    // chain only links entries within a session — comparing across
    // sessions (as the old impl did) is meaningless and was reporting
    // ~33% "broken" on healthy logs. Mirror the CLI --verify-audit path
    // (src/cli.ts:230-298) which is the authoritative shape.
    const sessions = new Map<string, AuditEntry[]>();
    for (const e of entries) {
      const sid = e.sessionId || 'unknown';
      if (!sessions.has(sid)) sessions.set(sid, []);
      sessions.get(sid)!.push(e);
    }

    let sessionsVerified = 0;
    let sessionsLegacy = 0;
    let legacyEntries = 0;
    let sessionsInvalid = 0;
    const invalidDetail: Array<{ sessionId: string; firstInvalidAt?: number; reason?: string }> = [];

    for (const [sid, sessionEntries] of sessions) {
      let result;
      try {
        result = AuditLogger.verify(sessionEntries);
      } catch (err) {
        sessionsInvalid++;
        invalidDetail.push({
          sessionId: sid,
          reason: `verifier threw: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }
      if (result.valid) {
        sessionsVerified++;
      } else if (result.legacy) {
        sessionsLegacy++;
        legacyEntries += sessionEntries.length;
      } else {
        sessionsInvalid++;
        invalidDetail.push({
          sessionId: sid,
          firstInvalidAt: result.firstInvalidAt,
          reason: result.reason,
        });
      }
    }

    DashboardServer.json(res, {
      totalSessions: sessions.size,
      totalEntries: entries.length,
      sessionsVerified,
      sessionsLegacy,
      legacyEntries,
      sessionsInvalid,
      invalidDetail: invalidDetail.slice(0, 50),
      chainIntegrity: sessionsInvalid === 0 ? 'verified' : 'broken',
    });
  });

  server.route('GET', '/api/audit/:sessionId', (_req, res, params) => {
    const auditDir = codebotPath('audit');
    const entries = (loadAuditEntries(auditDir, 0) as AuditEntry[]).filter(
      (e) => e.sessionId === params.sessionId
    );

    let result;
    try {
      result = AuditLogger.verify(entries);
    } catch (err) {
      result = {
        valid: false,
        entriesChecked: 0,
        reason: `verifier threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    DashboardServer.json(res, {
      sessionId: params.sessionId,
      entries,
      chainValid: result.valid,
      legacy: (result as { legacy?: boolean }).legacy === true,
      firstInvalidAt: (result as { firstInvalidAt?: number }).firstInvalidAt,
      reason: result.reason,
      entryCount: entries.length,
    });
  });

  // ── Metrics ──
  server.route('GET', '/api/metrics/summary', (_req, res) => {
    const sessionsDir = codebotPath('sessions');
    const auditDir = codebotPath('audit');

    const sessionCount = listSessionFiles(sessionsDir).length;
    const auditEntries = loadAuditEntries(auditDir, 0);

    // Aggregate audit stats
    const toolCounts: Record<string, number> = {};
    const actionCounts: Record<string, number> = {};
    for (const entry of auditEntries) {
      const tool = entry.tool || 'unknown';
      const action = entry.action || 'unknown';
      toolCounts[tool] = (toolCounts[tool] || 0) + 1;
      actionCounts[action] = (actionCounts[action] || 0) + 1;
    }

    DashboardServer.json(res, {
      sessions: sessionCount,
      auditEntries: auditEntries.length,
      toolUsage: toolCounts,
      actionBreakdown: actionCounts,
    });
  });

  // ── Usage ──
  server.route('GET', '/api/usage', (_req, res) => {
    // Return a usage summary from available sessions
    const sessionsDir = codebotPath('sessions');
    const sessions = listSessionFiles(sessionsDir).slice(-10); // Last 10 sessions

    const usage = sessions.map(f => {
      const id = path.basename(f, '.jsonl');
      const stat = safeStatSync(f);
      const lines = safeReadLines(f);
      return {
        sessionId: id,
        messageCount: lines.length,
        date: stat?.mtime?.toISOString() || null,
      };
    });

    DashboardServer.json(res, { usage });
  });

  // ── SARIF Export ──
  server.route('POST', '/api/audit/export', async (_req, res) => {
    const auditDir = codebotPath('audit');
    const entries = loadAuditEntries(auditDir, 0);

    // Build a simplified SARIF-like export
    DashboardServer.json(res, {
      format: 'sarif-summary',
      version: VERSION,
      exportedAt: new Date().toISOString(),
      entryCount: entries.length,
      entries: entries.slice(-1000),
    });
  });


  // ── Risk ──
  // PR 13 — these endpoints used to read `server._riskScorer`, a field
  // that nothing in the codebase ever assigned (`grep -rn _riskScorer
  // src/` returned only the two reads below). The handlers always fell
  // through to the "no scorer" branch and returned zeros + a misleading
  // "No risk data yet" message even after the agent had fired tools.
  //
  // Stateless rewrite: aggregate from the audit log directly. Audit is
  // the source of truth (§12), and it survives server / Electron-app
  // restarts in a way an in-memory scorer never could.
  //
  // **Honest scope of this metric.** `agent.ts:1052` only writes a
  // `result: "risk:N"` audit row when the assessed score is **> 50**
  // (yellow / orange / red levels). Green-level calls (≤ 50) do NOT
  // emit a risk row, so this summary is the **high-risk slice** of
  // activity, not "all tool calls." The response includes that note
  // verbatim so the dashboard UI can show it next to the number.
  //
  // If we ever want every-call-counted, it's a separate change to the
  // agent's audit emit — not something to fake here.
  function loadRiskFromAudit(days: number): Array<{ score: number; level: string; ts: string; tool: string }> {
    const auditDir = codebotPath('audit');
    const cutoff = days > 0 ? Date.now() - days * 86400 * 1000 : 0;
    const entries = loadAuditEntries(auditDir, cutoff) as AuditEntry[];
    const out: Array<{ score: number; level: string; ts: string; tool: string }> = [];
    for (const e of entries) {
      if (typeof e.result !== 'string') continue;
      const m = /^risk:(\d+)$/.exec(e.result);
      if (!m) continue;
      const score = parseInt(m[1], 10);
      if (!Number.isFinite(score)) continue;
      // Mirror RiskScorer.classifyLevel thresholds — keep this in sync
      // with src/risk.ts if those bands change.
      const level = score >= 75 ? 'red' : score >= 50 ? 'orange' : score >= 25 ? 'yellow' : 'green';
      out.push({ score, level, ts: e.timestamp, tool: e.tool });
    }
    return out;
  }

  server.route('GET', '/api/risk/summary', (_req, res) => {
    const samples = loadRiskFromAudit(0); // all-time
    const total = samples.length;
    const counts = { green: 0, yellow: 0, orange: 0, red: 0 };
    let sum = 0;
    let peak = 0;
    for (const s of samples) {
      counts[s.level as keyof typeof counts] = (counts[s.level as keyof typeof counts] || 0) + 1;
      sum += s.score;
      if (s.score > peak) peak = s.score;
    }
    DashboardServer.json(res, {
      total,
      ...counts,
      average: total > 0 ? Math.round((sum / total) * 100) / 100 : 0,
      peak,
      // Prevent the UI from showing this as "all tool calls" — it is
      // not. The agent only emits a risk audit row when score > 50, so
      // green calls are invisible to this aggregator.
      coverage: 'high-risk slice only (audit emits risk rows when score > 50; see src/agent.ts:1052)',
      source: 'audit-log',
    });
  });

  server.route('GET', '/api/risk/history', (req, res) => {
    const query = DashboardServer.parseQuery(req.url || '');
    const limit = Math.min(500, Math.max(1, parseInt(query.limit || '100', 10)));
    const samples = loadRiskFromAudit(0);
    DashboardServer.json(res, {
      history: samples.slice(-limit),
      total: samples.length,
      coverage: 'high-risk slice only (audit emits risk rows when score > 50)',
      source: 'audit-log',
    });
  });

  // ── Constitutional Safety (CORD + VIGIL) ──
  server.route('GET', '/api/constitutional', (_req, res) => {
    // Return constitutional metrics if available
    const metrics = (server as unknown as Record<string, unknown>)._constitutionalMetrics;
    if (!metrics) {
      DashboardServer.json(res, {
        enabled: false,
        message: 'Constitutional layer not active. Start CodeBot with an agent to see CORD metrics.',
      });
      return;
    }
    DashboardServer.json(res, { enabled: true, ...metrics });
  });

  // ── System Stats (for dashboard status panel) ──
  server.route('GET', '/api/system/stats', (_req, res) => {
    const os = require('os');
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const memUsage = process.memoryUsage();

    DashboardServer.json(res, {
      version: VERSION,
      uptime,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      hostname: os.hostname(),
      cpus: os.cpus().length,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      processMemory: {
        rss: memUsage.rss,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
      },
      provider: process.env.CODEBOT_PROVIDER || 'anthropic',
      model: process.env.CODEBOT_MODEL || 'claude-sonnet-4-6',
      pid: process.pid,
    });
  });

  // ── File Browser ──
  server.route('GET', '/api/files/browse', (req, res) => {
    const query = DashboardServer.parseQuery(req.url || '');
    const dirPath = query.path || root;

    const resolved = path.resolve(dirPath);
    if (!resolved.startsWith(root) && resolved !== root) {
      DashboardServer.error(res, 403, 'Access denied: path outside project');
      return;
    }

    try {
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      const items = entries
        .filter((e) => !e.name.startsWith('.') || e.name === '.env.example')
        .map((e) => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
          path: path.join(resolved, e.name),
          ext: e.isFile() ? path.extname(e.name).slice(1) : null,
          size: e.isFile() ? (() => { try { return fs.statSync(path.join(resolved, e.name)).size; } catch { return 0; } })() : null,
        }))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      DashboardServer.json(res, {
        path: resolved,
        parent: resolved !== root ? path.dirname(resolved) : null,
        items,
      });
    } catch {
      DashboardServer.error(res, 500, 'Cannot read directory');
    }
  });

  // ── File Read (for file explorer) ──
  server.route('GET', '/api/files/read', (req, res) => {
    const query = DashboardServer.parseQuery(req.url || '');
    const filePath = query.path;
    if (!filePath) { DashboardServer.error(res, 400, 'Missing path'); return; }

    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(root)) {
      DashboardServer.error(res, 403, 'Access denied');
      return;
    }

    try {
      const stat = fs.statSync(resolved);
      if (stat.size > 512 * 1024) {
        DashboardServer.json(res, { path: resolved, content: '(File too large to display: ' + Math.round(stat.size / 1024) + 'KB)', truncated: true });
        return;
      }
      const content = fs.readFileSync(resolved, 'utf-8');
      DashboardServer.json(res, { path: resolved, content, size: stat.size });
    } catch {
      DashboardServer.error(res, 404, 'File not found');
    }
  });

}

// ── File system helpers (fail-safe) ──

function listSessionFiles(dir: string): string[] {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => path.join(dir, f))
      .sort((a, b) => {
        const sa = safeStatSync(a);
        const sb = safeStatSync(b);
        return (sb?.mtimeMs || 0) - (sa?.mtimeMs || 0);
      });
  } catch {
    return [];
  }
}

function loadAuditEntries(dir: string, cutoffMs: number): any[] {
  try {
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => path.join(dir, f));

    const entries: any[] = [];
    for (const file of files) {
      const lines = safeReadLines(file);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (cutoffMs > 0 && entry.timestamp) {
            const ts = new Date(entry.timestamp).getTime();
            if (ts < cutoffMs) continue;
          }
          entries.push(entry);
        } catch { /* skip malformed lines */ }
      }
    }
    return entries;
  } catch {
    return [];
  }
}

function safeStatSync(filePath: string): fs.Stats | null {
  try { return fs.statSync(filePath); } catch { return null; }
}

function safeReadLines(filePath: string): string[] {
  try {
    return fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}
