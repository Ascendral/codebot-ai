/**
 * Command Center API — interactive endpoints for the dashboard.
 *
 * Provides: chat (SSE), terminal exec (SSE), quick actions, tool listing & execution.
 * Requires an Agent instance for chat/quick-action routes.
 */

import * as http from 'http';
import { spawn } from 'child_process';
import { DashboardServer } from './server';
import { Agent } from '../agent';
import { BLOCKED_PATTERNS, FILTERED_ENV_VARS } from '../tools/execute';

/** Predefined quick-action prompts */
const QUICK_ACTIONS: Record<string, string> = {
  'git-status': 'Run git status and show me the result briefly.',
  'run-tests': 'Run the project test suite and report a brief summary of results.',
  'list-tools': 'List all your available tools with a one-line description each.',
  'health-check': 'Check system health: run node --version, git --version, and df -h. Report briefly.',
  'git-log': 'Run git log --oneline -10 and show me the output.',
  'git-diff': 'Run git diff --stat and show me the summary.',
  'list-files': 'List the files in the current project root directory.',
  'npm-outdated': 'Run npm outdated and show me what packages need updating.',
};

/** Build a filtered env for child processes (strip secrets) */
function filteredEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of FILTERED_ENV_VARS) {
    delete env[key];
  }
  return env;
}

/**
 * Register command-center API routes on the dashboard server.
 * If agent is null, endpoints return 503 (standalone mode).
 */
export function registerCommandRoutes(
  server: DashboardServer,
  agent: Agent | null,
): void {
  let agentBusy = false;

  // ── GET /api/command/status — check if command center is available ──
  server.route('GET', '/api/command/status', (_req, res) => {
    DashboardServer.json(res, {
      available: agent !== null,
      agentBusy,
    });
  });

  // ── GET /api/command/tools — list all registered tools ──
  server.route('GET', '/api/command/tools', (_req, res) => {
    if (!agent) {
      DashboardServer.error(res, 503, 'Agent not available (standalone mode)');
      return;
    }
    const tools = agent.getToolRegistry().all().map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      permission: t.permission,
    }));
    DashboardServer.json(res, { tools });
  });

  // ── POST /api/command/tool/run — execute a single tool directly ──
  server.route('POST', '/api/command/tool/run', async (req, res) => {
    if (!agent) {
      DashboardServer.error(res, 503, 'Agent not available');
      return;
    }

    let body: { tool?: string; args?: Record<string, unknown> };
    try {
      body = (await DashboardServer.parseBody(req)) as typeof body;
    } catch {
      DashboardServer.error(res, 400, 'Invalid JSON body');
      return;
    }

    if (!body?.tool) {
      DashboardServer.error(res, 400, 'Missing "tool" field');
      return;
    }

    const tool = agent.getToolRegistry().get(body.tool);
    if (!tool) {
      DashboardServer.error(res, 404, `Tool "${body.tool}" not found`);
      return;
    }

    const startMs = Date.now();
    try {
      const result = await tool.execute(body.args || {});
      DashboardServer.json(res, {
        result,
        is_error: result.startsWith('Error:'),
        duration_ms: Date.now() - startMs,
      });
    } catch (err: unknown) {
      DashboardServer.json(res, {
        result: err instanceof Error ? err.message : String(err),
        is_error: true,
        duration_ms: Date.now() - startMs,
      });
    }
  });

  // ── POST /api/command/chat — send message to agent, stream SSE response ──
  server.route('POST', '/api/command/chat', async (req, res) => {
    if (!agent) {
      DashboardServer.error(res, 503, 'Agent not available');
      return;
    }

    let body: { message?: string };
    try {
      body = (await DashboardServer.parseBody(req)) as typeof body;
    } catch {
      DashboardServer.error(res, 400, 'Invalid JSON body');
      return;
    }

    if (!body?.message) {
      DashboardServer.error(res, 400, 'Missing "message" field');
      return;
    }

    if (agentBusy) {
      DashboardServer.error(res, 409, 'Agent is busy processing another request');
      return;
    }

    agentBusy = true;
    DashboardServer.sseHeaders(res);

    let closed = false;
    res.on('close', () => { closed = true; });

    try {
      for await (const event of agent.run(body.message)) {
        if (closed) break;
        DashboardServer.sseSend(res, event);
        if (event.type === 'done' || event.type === 'error') break;
      }
    } catch (err: unknown) {
      if (!closed) {
        DashboardServer.sseSend(res, {
          type: 'error',
          text: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      agentBusy = false;
      if (!closed) DashboardServer.sseClose(res);
    }
  });

  // ── POST /api/command/quick-action — run a predefined action via agent ──
  server.route('POST', '/api/command/quick-action', async (req, res) => {
    if (!agent) {
      DashboardServer.error(res, 503, 'Agent not available');
      return;
    }

    let body: { action?: string };
    try {
      body = (await DashboardServer.parseBody(req)) as typeof body;
    } catch {
      DashboardServer.error(res, 400, 'Invalid JSON body');
      return;
    }

    const prompt = QUICK_ACTIONS[body?.action || ''];
    if (!prompt) {
      DashboardServer.error(res, 400, `Unknown action: "${body?.action}". Available: ${Object.keys(QUICK_ACTIONS).join(', ')}`);
      return;
    }

    if (agentBusy) {
      DashboardServer.error(res, 409, 'Agent is busy processing another request');
      return;
    }

    agentBusy = true;
    DashboardServer.sseHeaders(res);

    let closed = false;
    res.on('close', () => { closed = true; });

    try {
      for await (const event of agent.run(prompt)) {
        if (closed) break;
        DashboardServer.sseSend(res, event);
        if (event.type === 'done' || event.type === 'error') break;
      }
    } catch (err: unknown) {
      if (!closed) {
        DashboardServer.sseSend(res, {
          type: 'error',
          text: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      agentBusy = false;
      if (!closed) DashboardServer.sseClose(res);
    }
  });

  // ── POST /api/command/exec — execute a shell command, stream stdout/stderr ──
  server.route('POST', '/api/command/exec', async (req, res) => {
    let body: { command?: string; cwd?: string };
    try {
      body = (await DashboardServer.parseBody(req)) as typeof body;
    } catch {
      DashboardServer.error(res, 400, 'Invalid JSON body');
      return;
    }

    if (!body?.command) {
      DashboardServer.error(res, 400, 'Missing "command" field');
      return;
    }

    // Security: check against blocked patterns
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(body.command)) {
        DashboardServer.error(res, 403, 'Blocked: dangerous command pattern detected');
        return;
      }
    }

    DashboardServer.sseHeaders(res);

    let closed = false;
    res.on('close', () => {
      closed = true;
      if (!child.killed) child.kill('SIGTERM');
    });

    const child = spawn('sh', ['-c', body.command], {
      cwd: body.cwd || process.cwd(),
      env: filteredEnv(),
    });

    child.stdout.on('data', (data: Buffer) => {
      if (!closed) DashboardServer.sseSend(res, { type: 'stdout', text: data.toString() });
    });

    child.stderr.on('data', (data: Buffer) => {
      if (!closed) DashboardServer.sseSend(res, { type: 'stderr', text: data.toString() });
    });

    child.on('close', (code) => {
      if (!closed) {
        DashboardServer.sseSend(res, { type: 'exit', code: code ?? 0 });
        DashboardServer.sseClose(res);
      }
    });

    child.on('error', (err) => {
      if (!closed) {
        DashboardServer.sseSend(res, { type: 'stderr', text: err.message });
        DashboardServer.sseSend(res, { type: 'exit', code: 1 });
        DashboardServer.sseClose(res);
      }
    });

    // 30s timeout
    const timer = setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGTERM');
        if (!closed) {
          DashboardServer.sseSend(res, { type: 'stderr', text: '\n[Timed out after 30s]' });
          DashboardServer.sseSend(res, { type: 'exit', code: 124 });
          DashboardServer.sseClose(res);
        }
      }
    }, 30_000);

    child.on('close', () => clearTimeout(timer));
  });

  // ── GET /api/command/history — get recent agent messages ──
  server.route('GET', '/api/command/history', (_req, res) => {
    if (!agent) {
      DashboardServer.json(res, { messages: [] });
      return;
    }
    const messages = agent.getMessages()
      .filter(m => m.role !== 'system')
      .slice(-100)
      .map(m => ({
        role: m.role,
        content: typeof m.content === 'string'
          ? m.content.substring(0, 5000)
          : String(m.content),
      }));
    DashboardServer.json(res, { messages });
  });
}
