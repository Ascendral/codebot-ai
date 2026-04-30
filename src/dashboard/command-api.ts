/**
 * Command Center API — interactive endpoints for the dashboard.
 *
 * Provides: chat (SSE), terminal exec (SSE), quick actions, tool listing & execution.
 * Terminal + Quick Actions work standalone. Chat + Tool Runner need an Agent.
 */

import * as http from 'http';
import * as crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { spawn } from 'child_process';
import { DashboardServer } from './server';
import { Agent } from '../agent';
import { SessionManager } from '../history';
import { BLOCKED_PATTERNS, FILTERED_ENV_VARS } from '../tools/execute';
import { PROVIDER_DEFAULTS } from '../providers/registry';
import { Config } from '../types';
import { loadConfig, pickProviderKey, normalizeProviderBaseUrl } from '../setup';
import { createProvider } from '../cli/config';
import { getProactiveEngine } from '../proactive';
import { loadWorkflows, getWorkflow, resolveWorkflowPrompt, WORKFLOW_CATEGORIES } from '../workflows';

/** Quick-action definitions: AI prompt (agent) + shell command (standalone) */
const QUICK_ACTIONS: Record<string, { prompt: string; command: string }> = {
  'git-status':   { prompt: 'Run git status and show me the result briefly.',                      command: 'git status' },
  'run-tests':    { prompt: 'Run the project test suite and report a brief summary of results.',   command: 'npm test 2>&1 || true' },
  'health-check': { prompt: 'Check system health: run node --version, git --version, and df -h.',  command: 'echo "=== Node ===" && node --version && echo "=== Git ===" && git --version && echo "=== Disk ===" && df -h .' },
  'git-log':      { prompt: 'Run git log --oneline -10 and show me the output.',                   command: 'git log --oneline -10' },
  'git-diff':     { prompt: 'Run git diff --stat and show me the summary.',                        command: 'git diff --stat' },
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
 * Spawn a shell command and stream stdout/stderr as SSE events.
 * `headersAlreadySent` lets the caller write headers + an init event
 * first, then invoke this without double-writing status/headers.
 */
function execAndStream(
  res: http.ServerResponse,
  command: string,
  cwd?: string,
  headersAlreadySent = false,
): void {
  if (!headersAlreadySent) DashboardServer.sseHeaders(res);

  let closed = false;
  const child = spawn('sh', ['-c', command], {
    cwd: cwd || process.cwd(),
    env: filteredEnv(),
  });

  res.on('close', () => {
    closed = true;
    if (!child.killed) child.kill('SIGTERM');
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

  const timer = setTimeout(() => {
    if (!child.killed) {
      child.kill('SIGTERM');
      if (!closed) {
        DashboardServer.sseSend(res, { type: 'stderr', text: '\n[Timed out after 30s]' });
        DashboardServer.sseSend(res, { type: 'exit', code: 124 });
        DashboardServer.sseClose(res);
        closed = true;
      }
    }
  }, 30_000);

  child.on('close', () => clearTimeout(timer));
}

/**
 * Register command-center API routes on the dashboard server.
 * Terminal + Quick Actions work in standalone mode (no agent).
 * Chat + Tool Runner require an agent instance.
 */
export function registerCommandRoutes(
  server: DashboardServer,
  agent: Agent | null,
): void {
  let agentBusy = false;
  const messageQueue: Array<{ message: string; mode?: 'simple' | 'detailed'; resolve: (v: unknown) => void }> = [];
  const statusClients: Set<http.ServerResponse> = new Set();

  // PR 21 — visible always-ask permission prompts in the dashboard.
  //
  // The 2026-04-30T01:12:52 audit row showed `browser navigate
  // https://x.com/compose/tweet` get DENY-without-visible-prompt: the
  // CLI's stdin-based askPermission ran on the dashboard subprocess's
  // non-TTY stdin, hit the 30s timeout, and emitted "User denied
  // permission" while the user never saw a card to approve.
  //
  // The fix: when the agent is registered with the dashboard, we
  // override its askPermission with one that:
  //   1. Mints a uuid `requestId` for this prompt.
  //   2. Stores a Promise resolver in `pendingPermissionRequests`.
  //   3. Pushes the prompt onto `pendingPermissionEvents` so the next
  //      SSE event in the live chat stream carries it (the chat
  //      handler drains this queue between agent.run() yields).
  //   4. Returns the Promise — resolves on POST /api/command/permission/respond
  //      or after a 5-minute hard timeout.
  //
  // The 5-minute timeout is deliberately long. A user who walked
  // away should come back to a still-open card, not a silent deny.
  const pendingPermissionRequests = new Map<string, {
    resolve: (approved: boolean) => void;
    createdAt: number;
    timer: NodeJS.Timeout;
  }>();
  // PR 21 fix — `activeChatRes` is the currently-streaming SSE response.
  // The chat handler sets it on entry, clears on exit. askPermission
  // writes the `permission_request` event directly to this stream
  // (instead of queuing for the for-await loop to drain) because the
  // agent is BLOCKED on the askPermission Promise — the for-await
  // doesn't yield again until permission resolves, so a queued event
  // would never get emitted. Direct write breaks the deadlock.
  let activeChatRes: http.ServerResponse | null = null;
  const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;

  // PR 25 — tool-runner jobs + request context.
  //
  // Pre-PR-25 the tool-runner endpoint passed `interactivePrompt: false`
  // to runSingleTool, which made the agent gate skip askPermission
  // entirely and emit a "Non-interactive caller" deny — silent
  // auto-deny for any always-ask tool. Connector contracts that go
  // out of their way to require approval (send-on-behalf,
  // delete-data, spend-money) failed silently when invoked through
  // the tool-runner.
  //
  // The fix is async two-phase:
  //   1. POST /api/command/tool/run spawns a job (UUID), runs
  //      runSingleTool with `interactivePrompt: true` in the
  //      background, returns 202 with the job id and current status
  //      after a short grace period.
  //   2. askPermission runs as it does for chat — mints a request id,
  //      stores the resolver — but instead of writing to a chat SSE
  //      stream, it updates the tool-runner job's `permissionRequest`
  //      slot.
  //   3. UI polls GET /api/command/tool/run/result/:jobId. Sees
  //      status: 'approval_required' with the same `requestId` shape
  //      the chat path uses, surfaces a permission card, calls the
  //      existing POST /api/command/permission/respond.
  //   4. Approval resolves the askPermission Promise, the background
  //      runSingleTool continues, the job's status flips to
  //      'completed' or 'failed', the next poll returns it.
  //
  // Context routing uses AsyncLocalStorage so concurrent chat +
  // tool-runner requests on the same Agent instance don't collide
  // — the askPermission override reads the store to decide WHERE
  // the permission_request goes.
  type RequestContext =
    | { kind: 'chat' }
    | { kind: 'tool-runner'; jobId: string };
  const requestContext = new AsyncLocalStorage<RequestContext>();

  type ToolRunnerJob = {
    status: 'running' | 'approval_required' | 'completed' | 'failed';
    tool: string;
    args: Record<string, unknown>;
    permissionRequest?: {
      requestId: string;
      preview: { summary: string; details?: Record<string, unknown> } | null;
      risk: { score: number; level: string };
      args: Record<string, unknown>;
    };
    result?: { result: string; is_error?: boolean; blocked?: boolean; reason?: string };
    error?: string;
    startedAt: number;
    completedAt?: number;
  };
  const toolRunnerJobs = new Map<string, ToolRunnerJob>();
  // Reap finished jobs after 10 minutes so the map doesn't grow
  // unboundedly. Approval-required jobs follow the existing 5-min
  // PERMISSION_TIMEOUT_MS path; once they timeout the askPermission
  // resolver moves them to status='completed' (denied).
  const JOB_TTL_MS = 10 * 60 * 1000;
  setInterval(() => {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, job] of toolRunnerJobs) {
      if ((job.completedAt ?? job.startedAt) < cutoff) toolRunnerJobs.delete(id);
    }
  }, 60_000).unref();

  if (agent) {
    agent.setAskPermission(async (tool, args, risk, sandbox) => {
      const requestId = crypto.randomUUID();

      // If this is an `app` tool dispatching to a connector action with
      // a `preview()` declared per §8, call it (purely — no network)
      // and include the rendered preview summary in the prompt event.
      // This is the difference between "approve some inscrutable tool
      // call" and "approve THIS specific tweet."
      let preview: { summary: string; details?: Record<string, unknown> } | undefined;
      if (tool === 'app' && typeof args.action === 'string' && args.action.includes('.')) {
        try {
          const reg = agent.getToolRegistry();
          const appTool = reg.get('app') as unknown as {
            registry?: { get?: (n: string) => { actions?: Array<{ name: string; preview?: (a: Record<string, unknown>, c: string) => Promise<unknown> }> } };
          } | undefined;
          // Reach into the AppConnectorTool via the registry to find
          // the connector action's preview. If anything in this chain
          // is missing or throws, the prompt still fires — just
          // without the inline preview.
          const dotIdx = String(args.action).indexOf('.');
          const appName = String(args.action).substring(0, dotIdx);
          const actionName = String(args.action).substring(dotIdx + 1);
          const innerRegistry = (appTool as unknown as { registry?: unknown })?.registry as {
            get?: (n: string) => { actions?: Array<{ name: string; preview?: (a: Record<string, unknown>, c: string) => Promise<unknown> }> } | undefined;
          } | undefined;
          const connector = innerRegistry?.get?.(appName);
          const connectorAction = connector?.actions?.find(a => a.name === actionName);
          if (connectorAction?.preview) {
            const p = await connectorAction.preview(args, '');
            preview = p as { summary: string; details?: Record<string, unknown> };
          }
        } catch {
          // Preview is best-effort. Failing to render it must not
          // block the actual permission gate.
        }
      }

      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          if (pendingPermissionRequests.has(requestId)) {
            pendingPermissionRequests.delete(requestId);
            // Broadcast a timeout event so the renderer can clear the
            // card (rather than leave a stale one floating).
            broadcastStatus('working', { permissionTimedOut: requestId });
            resolve(false);
          }
        }, PERMISSION_TIMEOUT_MS);
        // Don't keep the event loop alive solely for this timer —
        // production servers run forever anyway, and tests need
        // graceful teardown without waiting 5 minutes.
        if (typeof timer.unref === 'function') timer.unref();

        pendingPermissionRequests.set(requestId, {
          resolve: (approved: boolean) => {
            clearTimeout(timer);
            resolve(approved);
          },
          createdAt: Date.now(),
          timer,
        });

        // PR 21+25 — dispatch the permission_request to the right
        // surface based on the AsyncLocalStorage context.
        const ctx = requestContext.getStore();
        const permEvent = {
          type: 'permission_request',
          permissionRequest: {
            requestId,
            tool,
            args,
            risk: risk || { score: 0, level: 'green' },
            sandbox: sandbox || { sandbox: false, network: false },
            preview: preview || null,
            timeoutMs: PERMISSION_TIMEOUT_MS,
          },
        };

        if (ctx?.kind === 'tool-runner') {
          // PR 25 — write to the job's permissionRequest slot. The
          // /api/command/tool/run/result/:jobId poller picks this
          // up and surfaces a structured "approval_required"
          // response, not an auto-deny.
          const job = toolRunnerJobs.get(ctx.jobId);
          if (job) {
            job.status = 'approval_required';
            job.permissionRequest = {
              requestId,
              preview: preview || null,
              risk: risk || { score: 0, level: 'green' },
              args,
            };
          } else {
            // Job vanished before askPermission fired — bail out.
            clearTimeout(timer);
            pendingPermissionRequests.delete(requestId);
            resolve(false);
          }
          return;
        }

        if (activeChatRes && !activeChatRes.writableEnded && !activeChatRes.destroyed) {
          // PR 21 — chat-stream path. Write the event directly to
          // the SSE response (cannot queue: agent is blocked on this
          // Promise; the for-await won't yield again until resolve).
          DashboardServer.sseSend(activeChatRes, permEvent);
          return;
        }

        // No active context — neither chat nor tool-runner. This
        // shouldn't happen in practice (every askPermission origin
        // we wire goes through one of the two branches) but resolving
        // false is safer than hanging forever.
        clearTimeout(timer);
        pendingPermissionRequests.delete(requestId);
        resolve(false);
      });
    });
  }

  /** Broadcast agent status to all SSE clients */
  function broadcastStatus(status: 'idle' | 'working' | 'done' | 'queued', extra?: Record<string, unknown>) {
    const data = { status, queueLength: messageQueue.length, ...extra };
    for (const client of statusClients) {
      if (client.writableEnded || client.destroyed) { statusClients.delete(client); continue; }
      try { DashboardServer.sseSend(client, data); } catch { statusClients.delete(client); }
    }
  }

  /** Process next queued message */
  async function processQueue() {
    if (agentBusy || messageQueue.length === 0 || !agent) return;
    const next = messageQueue.shift()!;
    broadcastStatus('working', { message: next.message });
    agentBusy = true;
    try {
      let result = '';
      for await (const event of agent.run(next.message)) {
        if (event.type === 'text') result += (event as any).text || '';
        if (event.type === 'tool_call') {
          const tc = (event as any).toolCall;
          broadcastStatus('working', { tool: tc?.name, action: tc?.args?.action || tc?.args?.command, message: next.message });
        }
        if (event.type === 'tool_result') {
          const tr = (event as any).toolResult;
          broadcastStatus('working', { toolDone: tr?.name, success: !tr?.is_error, message: next.message });
        }
        if (event.type === 'done' || event.type === 'error') break;
      }
      next.resolve({ result });
    } catch (err: unknown) {
      next.resolve({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      agentBusy = false;
      broadcastStatus(messageQueue.length > 0 ? 'queued' : 'idle');
      // Process next in queue
      if (messageQueue.length > 0) setTimeout(processQueue, 100);
    }
  }

  // ── GET /api/command/status ──
  server.route('GET', '/api/command/status', (_req, res) => {
    DashboardServer.json(res, {
      available: agent !== null,
      agentBusy,
    });
  });

  // ── GET /api/command/tools ──
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

  // ── POST /api/command/tool/run ──
  //
  // SECURITY — do NOT call `tool.execute(body.args)` directly here.
  //
  // Before 2026-04-23 this route invoked the tool registry entry straight
  // from HTTP, bypassing schema validation, policy allow-list, risk
  // scoring, ConstitutionalLayer (CORD + VIGIL), SPARK, permission
  // prompts, and AuditLogger. A dashboard token holder (or a compromised
  // local process able to read the token) could drive any registered
  // tool — `execute`, `write_file`, `docker`, `ssh_remote`, `delegate` —
  // with zero CORD decisions and zero audit entries.
  //
  // Agent.runSingleTool() replays the exact same gate chain that the
  // autonomous agent loop (src/agent.ts Phase 1) applies to LLM-proposed
  // tool calls. `interactivePrompt: false` makes always-ask / prompt
  // tools fail closed over HTTP — there is no user on the wire to
  // answer a readline prompt.
  server.route('POST', '/api/command/tool/run', async (req, res) => {
    if (!agent) {
      DashboardServer.error(res, 503, 'Agent not available');
      return;
    }

    let body: { tool?: string; args?: Record<string, unknown> };
    try {
      body = (await DashboardServer.parseBody(req)) as typeof body;
    } catch (err: any) {
      DashboardServer.error(res, 400, err.message || 'Invalid JSON body');
      return;
    }

    if (!body?.tool) {
      DashboardServer.error(res, 400, 'Missing "tool" field');
      return;
    }

    // Fast 404 for unknown tools so the response shape stays aligned
    // with the pre-fix behavior for that one case (dashboard UI relies on
    // a 404 to show "tool not found" rather than a 200-with-error-body).
    if (!agent.getToolRegistry().get(body.tool)) {
      DashboardServer.error(res, 404, `Tool "${body.tool}" not found`);
      return;
    }

    // SECURITY — skill_* tools are composite: their `execute()` runs a
    // pipeline of inner tool calls (execute / write_file / app / etc.).
    // Even though those inner steps are now routed through runSingleTool
    // in agent.ts (the gate chain replays for every step), we still
    // refuse skill invocations on this endpoint:
    //
    // 1. The inner-step callback is wired with `interactivePrompt: true`
    //    to match the autonomous-loop context (REPL / dashboard
    //    permission UI). If an HTTP caller reaches it, any inner step
    //    that needs a prompt would invoke askPermission — which on an
    //    HTTP-request thread with no UI attached would fail closed at
    //    best and hang the request at worst.
    // 2. Defense in depth: the dashboard UI has its own skill launcher
    //    (with an explicit plan + confirmation step) that does NOT go
    //    through this endpoint. A generic token-holder driving
    //    skill_* through this route is an attack shape, not a
    //    legitimate UX.
    //
    // If a future dashboard surface genuinely needs to drive skills
    // over HTTP, add a dedicated endpoint that does step-by-step
    // confirmation; do not lift this guard.
    if (body.tool.startsWith('skill_')) {
      DashboardServer.error(
        res,
        403,
        'Skill tools must be invoked via the skill launcher, not the generic tool runner.',
      );
      return;
    }

    // PR 25 — async tool-runner with structured approval-required path.
    //
    // Old behavior (silent auto-deny):
    //   runSingleTool({ interactivePrompt: false })
    //   → "Non-interactive caller; tool requires permission prompt"
    //   → caller saw `blocked:true` with no way to approve.
    //
    // New behavior (structured approval channel):
    //   1. Mint a jobId, register a ToolRunnerJob in toolRunnerJobs.
    //   2. Spawn the runSingleTool call inside a tool-runner-kind
    //      AsyncLocalStorage context. askPermission detects the ctx
    //      and updates the job's `permissionRequest` slot instead
    //      of writing to a chat SSE stream.
    //   3. Race: wait up to 250 ms for the agent to either complete
    //      (fast tools) OR transition to status='approval_required'.
    //      If neither, return status='running' and let the caller
    //      poll. (Long-running tools without permission needs are
    //      uncommon today — read connectors are sub-second — but
    //      the path covers them for free.)
    //   4. When the caller approves via /api/command/permission/respond,
    //      the askPermission Promise resolves, runSingleTool continues,
    //      job.status flips to 'completed' / 'failed'.
    //   5. Caller polls GET /api/command/tool/run/result/:jobId.
    //
    // The CALLER decides whether to wait or poll. Sync-style consumers
    // (curl, simple scripts) get a single 202 + poll loop. The
    // dashboard UI subscribes to SSE for the chat path, polls for
    // the tool-runner path — different surfaces, same approval
    // contract.
    const jobId = crypto.randomUUID();
    const job: ToolRunnerJob = {
      status: 'running',
      tool: body.tool,
      args: body.args || {},
      startedAt: Date.now(),
    };
    toolRunnerJobs.set(jobId, job);

    // Kick off the actual execution. Errors here are caught and
    // recorded on the job so the result endpoint can surface them.
    const execPromise = requestContext.run({ kind: 'tool-runner', jobId }, async () => {
      try {
        const outcome = await agent.runSingleTool(body.tool!, body.args || {}, {
          interactivePrompt: true,
        });
        const j = toolRunnerJobs.get(jobId);
        if (j) {
          j.status = 'completed';
          j.result = {
            result: outcome.result,
            is_error: outcome.is_error,
            blocked: outcome.blocked,
            reason: outcome.reason,
          };
          j.completedAt = Date.now();
        }
      } catch (err: unknown) {
        const j = toolRunnerJobs.get(jobId);
        if (j) {
          j.status = 'failed';
          j.error = err instanceof Error ? err.message : String(err);
          j.completedAt = Date.now();
        }
      }
    });

    // Race the execution against a 250 ms grace period. If the tool
    // is fast (most reads), we return the result inline. If it's
    // slow OR needs approval, we return 202 with the job state and
    // the caller polls.
    const grace = new Promise(resolve => setTimeout(resolve, 250));
    await Promise.race([execPromise, grace]);

    const after = toolRunnerJobs.get(jobId)!;
    const elapsed = Date.now() - job.startedAt;

    if (after.status === 'completed' && after.result) {
      DashboardServer.json(res, {
        jobId,
        status: 'completed',
        result: after.result.result,
        is_error: after.result.is_error,
        blocked: after.result.blocked,
        reason: after.result.reason,
        duration_ms: elapsed,
      });
      return;
    }
    if (after.status === 'failed') {
      DashboardServer.json(res, {
        jobId,
        status: 'failed',
        error: after.error,
        duration_ms: elapsed,
      });
      return;
    }
    if (after.status === 'approval_required' && after.permissionRequest) {
      // 202 Accepted — caller must approve via
      // POST /api/command/permission/respond, then poll
      // GET /api/command/tool/run/result/:jobId.
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jobId,
        status: 'approval_required',
        permissionRequest: {
          requestId: after.permissionRequest.requestId,
          tool: body.tool,
          args: after.permissionRequest.args,
          risk: after.permissionRequest.risk,
          preview: after.permissionRequest.preview,
          timeoutMs: PERMISSION_TIMEOUT_MS,
        },
        hint: 'POST /api/command/permission/respond with {requestId, approved} to approve, then GET /api/command/tool/run/result/' + jobId + ' to retrieve the result.',
      }));
      return;
    }
    // Still running after the grace period — return 202 with
    // poll URL.
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jobId,
      status: 'running',
      pollUrl: '/api/command/tool/run/result/' + jobId,
      hint: 'Poll the result endpoint until status is completed/failed/approval_required.',
    }));
  });

  // PR 25 — GET /api/command/tool/run/result/:jobId
  // Companion endpoint for the async tool-runner. Returns the
  // current state of a job. UI / curl polls this until status
  // moves out of running/approval_required into completed/failed.
  server.route('GET', '/api/command/tool/run/result/:jobId', (_req, res, params) => {
    const job = toolRunnerJobs.get(params.jobId);
    if (!job) {
      DashboardServer.error(res, 404, 'Unknown or expired jobId');
      return;
    }
    if (job.status === 'completed' && job.result) {
      DashboardServer.json(res, {
        jobId: params.jobId,
        status: 'completed',
        result: job.result.result,
        is_error: job.result.is_error,
        blocked: job.result.blocked,
        reason: job.result.reason,
        duration_ms: (job.completedAt ?? Date.now()) - job.startedAt,
      });
      return;
    }
    if (job.status === 'failed') {
      DashboardServer.json(res, {
        jobId: params.jobId,
        status: 'failed',
        error: job.error,
        duration_ms: (job.completedAt ?? Date.now()) - job.startedAt,
      });
      return;
    }
    if (job.status === 'approval_required' && job.permissionRequest) {
      DashboardServer.json(res, {
        jobId: params.jobId,
        status: 'approval_required',
        permissionRequest: {
          requestId: job.permissionRequest.requestId,
          tool: job.tool,
          args: job.permissionRequest.args,
          risk: job.permissionRequest.risk,
          preview: job.permissionRequest.preview,
          timeoutMs: PERMISSION_TIMEOUT_MS,
        },
      });
      return;
    }
    DashboardServer.json(res, {
      jobId: params.jobId,
      status: 'running',
      duration_ms: Date.now() - job.startedAt,
    });
  });

  // ── GET /api/command/agent-status (SSE) ──
  server.route('GET', '/api/command/agent-status', (_req, res) => {
    DashboardServer.sseHeaders(res);
    statusClients.add(res);
    DashboardServer.sseSend(res, { status: agentBusy ? 'working' : 'idle', queueLength: messageQueue.length });
    // Heartbeat keeps Safari/proxy connections alive
    const hb = setInterval(() => {
      if (res.writableEnded || res.destroyed) { clearInterval(hb); statusClients.delete(res); return; }
      try { res.write(': heartbeat\n\n'); } catch { clearInterval(hb); statusClients.delete(res); }
    }, 15_000);
    res.on('close', () => { clearInterval(hb); statusClients.delete(res); });
  });


  // ── POST /api/command/chat/reset — start a new conversation ──
  //
  // Also reloads the provider from ~/.codebot/config.json so that a model
  // change from the dashboard dropdown takes effect immediately.  Without
  // this, the agent keeps using the provider it was created with at startup
  // (e.g. OpenAI chat-completions) even after the user selects gpt-5.4,
  // which lives on the Responses API. The old code only cleared conversation
  // history — the wrong provider was still firing.
  // PR 21 — POST /api/command/permission/respond
  // Renderer calls this when the user clicks Approve or Deny on the
  // permission card surfaced via the `permission_request` SSE event.
  // Body: { requestId: string, approved: boolean }
  // Resolves the pending askPermission Promise; the agent gate
  // continues from there. Idempotent: a second response for the same
  // requestId is a no-op (the first wins).
  server.route('POST', '/api/command/permission/respond', async (req, res) => {
    let body: { requestId?: string; approved?: boolean };
    try {
      body = (await DashboardServer.parseBody(req)) as typeof body;
    } catch (err: any) {
      DashboardServer.error(res, 400, err.message || 'Invalid JSON body');
      return;
    }
    if (!body || typeof body.requestId !== 'string' || typeof body.approved !== 'boolean') {
      DashboardServer.error(res, 400, 'Body requires { requestId: string, approved: boolean }');
      return;
    }
    const pending = pendingPermissionRequests.get(body.requestId);
    if (!pending) {
      DashboardServer.json(res, { ok: false, error: 'unknown_or_expired_request' });
      return;
    }
    pendingPermissionRequests.delete(body.requestId);
    pending.resolve(body.approved);
    DashboardServer.json(res, { ok: true, requestId: body.requestId, approved: body.approved });
  });

  // PR 21 — GET /api/command/permission/pending
  // Diagnostic: lists currently-open permission requests. Useful for
  // debugging "why is the chat hanging?" without reading source.
  server.route('GET', '/api/command/permission/pending', (_req, res) => {
    const now = Date.now();
    const items = Array.from(pendingPermissionRequests.entries()).map(([id, p]) => ({
      requestId: id,
      ageMs: now - p.createdAt,
    }));
    DashboardServer.json(res, { count: items.length, items });
  });

  server.route('POST', '/api/command/chat/reset', async (_req, res) => {
    if (!agent) {
      DashboardServer.error(res, 503, 'Agent not available');
      return;
    }
    try {
      const saved = normalizeProviderBaseUrl(loadConfig());
      const model = saved.model || 'qwen2.5-coder:32b';
      const providerName = saved.provider || 'local';
      const apiKey = pickProviderKey(saved, providerName);
      let baseUrl = saved.baseUrl || '';
      if (!baseUrl) {
        const defaults = PROVIDER_DEFAULTS[providerName];
        if (defaults) baseUrl = defaults.baseUrl;
      }
      const cfg: Config = {
        model,
        provider: providerName,
        baseUrl,
        apiKey,
        maxIterations: 50,
        autoApprove: false,
      };
      const newProvider = createProvider(cfg);
      agent.setProvider(newProvider, model, providerName);
    } catch {
      // Provider reload failed — fall back to clearing history only.
      agent.resetConversation();
    }
    DashboardServer.json(res, { reset: true });
  });

  // ── GET  /api/command/vault — current vault-mode state ──
  // ── POST /api/command/vault — enable or disable vault mode ──
  //
  // Body: { vaultPath: string, writable?: boolean, networkAllowed?: boolean }
  //   - vaultPath empty/null → disable vault mode, return to coding-agent
  //   - vaultPath set        → validate + chdir + swap tools/prompt
  //
  // Calls Agent.setVaultMode() under the hood; see src/agent.ts for the
  // runtime-swap mechanics.
  server.route('GET', '/api/command/vault', async (_req, res) => {
    if (!agent) {
      DashboardServer.error(res, 503, 'Agent not available');
      return;
    }
    DashboardServer.json(res, { vault: agent.getVaultMode() });
  });

  server.route('POST', '/api/command/vault', async (req, res) => {
    if (!agent) {
      DashboardServer.error(res, 503, 'Agent not available');
      return;
    }
    let body: { vaultPath?: string | null; writable?: boolean; networkAllowed?: boolean };
    try {
      body = (await DashboardServer.parseBody(req)) as typeof body;
    } catch (err: any) {
      DashboardServer.error(res, 400, err.message || 'Invalid JSON body');
      return;
    }

    // Empty path → disable
    const raw = (body?.vaultPath || '').trim();
    if (!raw) {
      agent.setVaultMode(null);
      DashboardServer.json(res, { vault: null, disabled: true });
      return;
    }

    // Validate path: must exist + be a directory
    const homedir = require('os').homedir();
    const fs = require('fs');
    const path = require('path');
    const expanded = raw.startsWith('~') ? raw.replace(/^~/, homedir) : raw;
    const vaultPath = path.resolve(expanded);
    if (!fs.existsSync(vaultPath)) {
      DashboardServer.error(res, 400, `Vault path does not exist: ${vaultPath}`);
      return;
    }
    if (!fs.statSync(vaultPath).isDirectory()) {
      DashboardServer.error(res, 400, `Vault path is not a directory: ${vaultPath}`);
      return;
    }

    const opts = {
      vaultPath,
      writable: !!body?.writable,
      networkAllowed: !!body?.networkAllowed,
    };
    agent.setVaultMode(opts);
    DashboardServer.json(res, { vault: opts, enabled: true });
  });

  // ── POST /api/command/chat (agent only) ──
  server.route('POST', '/api/command/chat', async (req, res) => {
    if (!agent) {
      DashboardServer.error(res, 503, 'Agent not available');
      return;
    }

    let body: {
      message?: string;
      mode?: 'simple' | 'detailed';
      images?: Array<{ data: string; mediaType: string }>;
      autoApprove?: boolean;
    };
    try {
      body = (await DashboardServer.parseBody(req)) as typeof body;
    } catch (err: any) {
      DashboardServer.error(res, 400, err.message || 'Invalid JSON body');
      return;
    }

    if (!body?.message && (!body?.images || body.images.length === 0)) {
      DashboardServer.error(res, 400, 'Missing "message" field');
      return;
    }

    // PR 16 — honor `autoApprove` from the request body. Pre-this-fix
    // the chat handler ignored body.autoApprove entirely; the agent's
    // autoApprove was set at construction time and never changed per
    // request. That made the dashboard chat unable to drive any tool
    // call that hit a `prompt`-tier permission, since the gate would
    // wait for an interactive `y/n` that the SSE caller can't supply.
    // Now the request can opt into autoApprove explicitly. The opt-in
    // is per-request: we snapshot the previous value, apply the
    // request's value for the duration of agent.run, and restore in
    // the finally block. NEVER_ALLOWABLE capability labels remain
    // hard-rejected via the existing PR-11 path; autoApprove only
    // affects regular permission prompts.
    const requestedAutoApprove = body.autoApprove === true;
    const priorAutoApprove = agent.getAutoApprove();
    if (requestedAutoApprove !== priorAutoApprove) {
      agent.setAutoApprove(requestedAutoApprove);
    }

    if (agentBusy) {
      // Queue the message instead of rejecting
      const queuePromise = new Promise((resolve) => {
        messageQueue.push({ message: body.message!, mode: body.mode, resolve });
      });
      broadcastStatus('queued', { position: messageQueue.length });
      DashboardServer.json(res, {
        queued: true,
        position: messageQueue.length,
        message: 'Message queued — agent will process it next',
      });
      // finally block's setTimeout already calls processQueue when agent finishes
      queuePromise.catch(() => {});
      return;
    }

    // Simple mode: prepend plain-language instruction for non-technical users
    let userMessage = body.message || '';
    if (body.mode === 'simple') {
      userMessage = '[Respond in plain, simple language suitable for someone who is not a programmer. Be concise and friendly. Focus on results, not technical details.]\n\n' + userMessage;
    }

    agentBusy = true;
    broadcastStatus('working', { message: body.message });
    DashboardServer.sseHeaders(res);

    let closed = false;
    res.on('close', () => { closed = true; });

    // Heartbeat keeps connection alive through proxies/Safari
    const heartbeat = setInterval(() => {
      if (closed || res.writableEnded || res.destroyed) { clearInterval(heartbeat); return; }
      try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); closed = true; }
    }, 15_000);

    try {
      // Pass images through to agent if provided
      const chatImages = body.images?.map((img: { data: string; mediaType: string }) => ({
        data: img.data,
        mediaType: img.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
      }));
      // PR 21 — install this response as the active SSE target so the
      // askPermission override can write directly to it (see
      // setAskPermission setup above for why we can't queue).
      // PR 25 — wrap in a chat-kind AsyncLocalStorage context so
      // askPermission can distinguish chat from tool-runner.
      activeChatRes = res;
      await requestContext.run({ kind: 'chat' }, async () => {
        for await (const event of agent.run(userMessage, chatImages)) {
          if (closed || res.writableEnded || res.destroyed) break;
          DashboardServer.sseSend(res, event);
          if (event.type === 'done' || event.type === 'error') break;
        }
      });
    } catch (err: unknown) {
      if (!closed && !res.writableEnded && !res.destroyed) {
        DashboardServer.sseSend(res, {
          type: 'error',
          text: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      clearInterval(heartbeat);
      closed = true;
      agentBusy = false;
      // PR 21 — clear the active SSE target so subsequent permission
      // requests outside a chat (tool runner, queued messages with
      // their own res) don't accidentally write onto a closed stream.
      if (activeChatRes === res) activeChatRes = null;
      broadcastStatus(messageQueue.length > 0 ? 'queued' : 'idle');
      // PR 16 — restore the agent's autoApprove to its pre-request
      // value. Per-request opt-in must not leak into the next chat or
      // into the queued message handler, which has its own autoApprove
      // semantics (see processQueue above — currently inherits the
      // agent's then-current value).
      if (requestedAutoApprove !== priorAutoApprove) {
        agent.setAutoApprove(priorAutoApprove);
      }
      if (!res.writableEnded && !res.destroyed) {
        res.write('data: [DONE]\n\n');
        DashboardServer.sseClose(res);
      }
      // Process any queued messages
      if (messageQueue.length > 0) setTimeout(processQueue, 100);
    }
  });

  // ── POST /api/command/quick-action (works standalone via exec) ──
  server.route('POST', '/api/command/quick-action', async (req, res) => {
    let body: { action?: string };
    try {
      body = (await DashboardServer.parseBody(req)) as typeof body;
    } catch (err: any) {
      DashboardServer.error(res, 400, err.message || 'Invalid JSON body');
      return;
    }

    const actionDef = QUICK_ACTIONS[body?.action || ''];
    if (!actionDef) {
      DashboardServer.error(res, 400, `Unknown action: "${body?.action}". Available: ${Object.keys(QUICK_ACTIONS).join(', ')}`);
      return;
    }

    // Agent mode: use AI
    if (agent) {
      if (agentBusy) {
        DashboardServer.error(res, 409, 'Agent is busy processing another request');
        return;
      }
      agentBusy = true;
      DashboardServer.sseHeaders(res);

      let closed = false;
      res.on('close', () => { closed = true; });

      // Heartbeat keeps connection alive through proxies/Safari
      const qaHeartbeat = setInterval(() => {
        if (closed || res.writableEnded || res.destroyed) { clearInterval(qaHeartbeat); return; }
        try { res.write(': heartbeat\n\n'); } catch { clearInterval(qaHeartbeat); closed = true; }
      }, 15_000);

      try {
        for await (const event of agent.run(actionDef.prompt)) {
          if (closed || res.writableEnded || res.destroyed) break;
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
        clearInterval(qaHeartbeat);
        agentBusy = false;
        broadcastStatus(messageQueue.length > 0 ? 'queued' : 'idle');
        if (!closed) {
          res.write('data: [DONE]\n\n');
          DashboardServer.sseClose(res);
        }
        if (messageQueue.length > 0) setTimeout(processQueue, 100);
      }
      return;
    }

    // Standalone mode: run shell command directly
    execAndStream(res, actionDef.command);
  });

  // ── POST /api/command/exec ──
  //
  // Agent-backed mode (default): routes through Agent.runStreamingTool
  // → ExecuteTool.stream, replaying the full gate chain (policy, risk,
  // CORD, SPARK, capability, permission) AND the tool's own preflight
  // (BLOCKED_PATTERNS, cwd containment, sandbox decision). Writes
  // exec_start / exec_complete / exec_error audit entries.
  //
  // Standalone mode (agent=null): keeps the pre-2026-04-24 behavior —
  // inline regex check + direct spawn. The SSE init event advertises
  // `{ mode: 'standalone', guarded: false }` so clients can warn.
  server.route('POST', '/api/command/exec', async (req, res) => {
    let body: { command?: string; cwd?: string };
    try {
      body = (await DashboardServer.parseBody(req)) as typeof body;
    } catch (err: any) {
      DashboardServer.error(res, 400, err.message || 'Invalid JSON body');
      return;
    }

    if (!body?.command) {
      DashboardServer.error(res, 400, 'Missing "command" field');
      return;
    }

    // Belt-and-suspenders: keep the inline regex pre-check even in
    // agent-backed mode. The tool-level preflight re-checks the same
    // patterns, but this guarantees a 403 before any SSE headers go
    // out for the obvious bad cases, and keeps the standalone path
    // working unchanged if the agent is unavailable.
    //
    // Audit honesty: when the agent is attached, log the block through
    // the agent's audit logger so the claim "dangerous command blocked
    // and audited" is actually true on this code path. If the request
    // never reaches `runStreamingTool`, nothing downstream will ever
    // write that entry for us. Standalone mode has no audit logger —
    // that is a known gap and is exactly what `guarded:false` warns
    // about in the init event.
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(body.command)) {
        if (agent) {
          agent.getAuditLogger().log({
            tool: 'execute',
            action: 'policy_block',
            args: { command: body.command, ...(typeof body.cwd === 'string' ? { cwd: body.cwd } : {}) },
            reason: 'inline BLOCKED_PATTERNS pre-check (dashboard /api/command/exec)',
          });
        }
        DashboardServer.error(res, 403, 'Blocked: dangerous command pattern detected');
        return;
      }
    }

    if (!agent) {
      DashboardServer.sseHeaders(res);
      DashboardServer.sseSend(res, { type: 'init', mode: 'standalone', guarded: false });
      execAndStream(res, body.command, body.cwd, /* headersAlreadySent */ true);
      return;
    }

    DashboardServer.sseHeaders(res);
    DashboardServer.sseSend(res, { type: 'init', mode: 'agent', guarded: true });

    // Schema validator rejects `cwd: undefined` (expected string), so
    // only include cwd in args when the caller actually supplied one.
    // The tool defaults to projectRoot when cwd is absent.
    const streamArgs: Record<string, unknown> = { command: body.command };
    if (typeof body.cwd === 'string' && body.cwd.length > 0) {
      streamArgs.cwd = body.cwd;
    }

    const outcome = await agent.runStreamingTool(
      'execute',
      streamArgs,
      {
        onStdout: (text) => DashboardServer.sseSend(res, { type: 'stdout', text }),
        onStderr: (text) => DashboardServer.sseSend(res, { type: 'stderr', text }),
      },
      { interactivePrompt: false, streamTimeoutMs: 30_000 },
    );

    if (outcome.blocked) {
      DashboardServer.sseSend(res, { type: 'blocked', reason: outcome.reason });
      DashboardServer.sseClose(res);
      return;
    }
    if (outcome.error) {
      // Map tool-level refusals to structured SSE events. The client
      // currently renders these as a red line in the terminal UI.
      const httpCode = outcome.errorCode === 'sandbox_required' ? 501 : 500;
      DashboardServer.sseSend(res, {
        type: 'error',
        code: httpCode,
        errorCode: outcome.errorCode,
        reason: outcome.reason,
      });
      DashboardServer.sseClose(res);
      return;
    }
    DashboardServer.sseSend(res, { type: 'exit', code: outcome.exitCode });
    DashboardServer.sseClose(res);
  });


  // ── GET /api/notifications ──
  server.route('GET', '/api/notifications', (_req, res) => {
    const engine = getProactiveEngine();
    if (!engine) { DashboardServer.json(res, { notifications: [], unreadCount: 0 }); return; }
    DashboardServer.json(res, {
      notifications: engine.getAll(),
      unreadCount: engine.getUnreadCount(),
    });
  });

  // ── POST /api/notifications/dismiss-all ──
  server.route('POST', '/api/notifications/dismiss-all', (_req, res) => {
    const engine = getProactiveEngine();
    if (!engine) { DashboardServer.json(res, { dismissed: 0 }); return; }
    const count = engine.dismissAll();
    DashboardServer.json(res, { dismissed: count });
  });

  // ── POST /api/notifications/:id/:action ──
  server.route('POST', '/api/notifications/:id/:action', (_req, res, params) => {
    const engine = getProactiveEngine();
    if (!engine) { DashboardServer.error(res, 503, 'Notification engine not available'); return; }
    if (params.action === 'dismiss') {
      const ok = engine.dismiss(params.id);
      DashboardServer.json(res, { dismissed: ok });
    } else if (params.action === 'read') {
      const ok = engine.markRead(params.id);
      DashboardServer.json(res, { read: ok });
    } else {
      DashboardServer.error(res, 400, 'Unknown action. Use /dismiss or /read');
    }
  });

  // ── GET /api/notifications/stream (SSE) ──
  server.route('GET', '/api/notifications/stream', (_req, res) => {
    DashboardServer.sseHeaders(res);
    const engine = getProactiveEngine();
    if (!engine) { DashboardServer.sseSend(res, { type: 'init', unreadCount: 0 }); DashboardServer.sseClose(res); return; }

    const listener = (notification: unknown) => {
      if (res.writable) {
        DashboardServer.sseSend(res, { type: 'notification', notification });
      }
    };

    engine.onNotification(listener);

    res.on('close', () => {
      engine.removeListener(listener);
    });

    // Heartbeat keeps connections alive
    const nhb = setInterval(() => {
      if (res.writableEnded || res.destroyed) { clearInterval(nhb); return; }
      try { res.write(': heartbeat\n\n'); } catch { clearInterval(nhb); }
    }, 30_000);
    res.on('close', () => clearInterval(nhb));

    // Send initial unread count
    DashboardServer.sseSend(res, {
      type: 'init',
      unreadCount: engine.getUnreadCount(),
    });
  });

  // ── GET /api/workflows ──
  server.route('GET', '/api/workflows', (_req, res) => {
    const workflows = loadWorkflows();
    DashboardServer.json(res, {
      workflows: workflows.map(w => ({
        name: w.name,
        description: w.description,
        category: w.category,
        icon: w.icon,
        color: w.color,
        inputFields: w.inputFields,
      })),
      categories: WORKFLOW_CATEGORIES,
    });
  });

  // ── GET /api/workflows/:name ──
  server.route('GET', '/api/workflows/:name', (_req, res, params) => {
    const workflow = getWorkflow(params.name);
    if (!workflow) {
      DashboardServer.error(res, 404, 'Workflow "' + params.name + '" not found');
      return;
    }
    DashboardServer.json(res, { workflow });
  });

  // ── POST /api/workflows/:name/run (SSE stream) ──
  server.route('POST', '/api/workflows/:name/run', async (req, res, params) => {
    if (!agent) {
      DashboardServer.error(res, 503, 'Agent not available');
      return;
    }

    const workflow = getWorkflow(params.name);
    if (!workflow) {
      DashboardServer.error(res, 404, 'Workflow "' + params.name + '" not found');
      return;
    }

    let body: Record<string, string>;
    try {
      body = (await DashboardServer.parseBody(req)) as Record<string, string>;
    } catch (err: any) {
      DashboardServer.error(res, 400, err.message || 'Invalid JSON body');
      return;
    }

    if (agentBusy) {
      DashboardServer.error(res, 409, 'Agent is busy processing another request');
      return;
    }

    const prompt = resolveWorkflowPrompt(workflow, body || {});

    agentBusy = true;
    DashboardServer.sseHeaders(res);

    let closed = false;
    res.on('close', () => { closed = true; });

    // Heartbeat keeps connection alive through proxies/Safari
    const wfHeartbeat = setInterval(() => {
      if (closed || res.writableEnded || res.destroyed) { clearInterval(wfHeartbeat); return; }
      try { res.write(': heartbeat\n\n'); } catch { clearInterval(wfHeartbeat); closed = true; }
    }, 15_000);

    try {
      for await (const event of agent.run(prompt)) {
        if (closed) break;
        DashboardServer.sseSend(res, event);
        if (event.type === 'done' || event.type === 'error') break;
      }
    } catch (err) {
      if (!closed) {
        DashboardServer.sseSend(res, {
          type: 'error',
          text: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      clearInterval(wfHeartbeat);
      agentBusy = false;
      broadcastStatus(messageQueue.length > 0 ? 'queued' : 'idle');
      if (!closed) {
        res.write('data: [DONE]\n\n');
        DashboardServer.sseClose(res);
      }
      if (messageQueue.length > 0) setTimeout(processQueue, 100);
    }
  });

  // ── POST /api/command/resume ──
  server.route('POST', '/api/command/resume', async (req, res) => {
    if (!agent) {
      DashboardServer.error(res, 503, 'Agent not available');
      return;
    }
    if (agentBusy) {
      DashboardServer.error(res, 409, 'Agent is busy');
      return;
    }

    let body: { sessionId?: string };
    try {
      body = (await DashboardServer.parseBody(req)) as typeof body;
    } catch (err: any) {
      DashboardServer.error(res, 400, err.message || 'Invalid JSON body');
      return;
    }

    if (!body?.sessionId) {
      DashboardServer.error(res, 400, 'Missing "sessionId" field');
      return;
    }

    const sm = new SessionManager('resume', body.sessionId);
    const messages = sm.load();

    if (messages.length === 0) {
      DashboardServer.error(res, 404, 'Session not found or empty');
      return;
    }

    agent.loadMessages(messages);

    DashboardServer.json(res, {
      sessionId: body.sessionId,
      messageCount: messages.length,
      resumed: true,
    });
  });

  // ── GET /api/command/history ──
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
