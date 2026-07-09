/**
 * Claude Code hook adapter.
 *
 * Claude Code invokes PreToolUse/PostToolUse hooks as one short-lived
 * process per tool call, passing event JSON on stdin. This module turns
 * those events into hash-chained audit entries and (rarely) blocking
 * decisions.
 *
 * Intervention philosophy: observe everything, intervene rarely. The
 * adapter emits a permissionDecision ONLY to deny (policy block,
 * prohibited capability) or to ask (always-ask capability, red risk).
 * It never emits "allow" — that would bypass Claude Code's own
 * permission flow, which must remain the primary gate.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AuditLogger, AuditEntry } from './audit';
import { PolicyEnforcer, loadPolicy } from './policy';
import { RiskScorer, RiskAssessment } from './risk';
import {
  strictestPermissionForCapabilityLabels,
  Permission,
} from './capability-gating';
import { CapabilityLabel } from './types';

/** Claude Code hook event, as delivered on stdin. */
export interface HookEvent {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: 'PreToolUse' | 'PostToolUse' | string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
}

/** What the adapter decided for a PreToolUse event. */
export interface HookDecision {
  /** undefined → no opinion; Claude Code's own permission flow proceeds */
  permissionDecision?: 'deny' | 'ask';
  reason?: string;
  risk: RiskAssessment;
  labels: CapabilityLabel[];
  permission: Permission;
}

/**
 * Claude Code tool name → capability labels.
 *
 * Prefix rules handle families (mcp__*). Unknown tools get run-cmd —
 * conservative without being a hard block, since an unknown tool's
 * blast radius is unknown.
 */
const CLAUDE_TOOL_LABELS: Record<string, CapabilityLabel[]> = {
  // read-only
  Read: ['read-only'],
  Glob: ['read-only'],
  Grep: ['read-only'],
  LS: ['read-only'],
  NotebookRead: ['read-only'],
  TodoWrite: ['read-only'], // agent-internal bookkeeping, no external effect
  Think: ['read-only'],
  // filesystem writes
  Write: ['write-fs'],
  Edit: ['write-fs'],
  MultiEdit: ['write-fs'],
  NotebookEdit: ['write-fs'],
  // command execution
  Bash: ['run-cmd'],
  BashOutput: ['read-only'],
  KillShell: ['run-cmd'],
  // network
  WebFetch: ['net-fetch'],
  WebSearch: ['net-fetch'],
  // subagents can do anything their tools allow
  Task: ['run-cmd'],
  Agent: ['run-cmd'],
};

export function labelsForClaudeTool(toolName: string): CapabilityLabel[] {
  if (CLAUDE_TOOL_LABELS[toolName]) return CLAUDE_TOOL_LABELS[toolName];
  // MCP tools reach external services through connected accounts
  if (toolName.startsWith('mcp__')) return ['account-access'];
  return ['run-cmd'];
}

/** Session id used in the audit log (namespaced to avoid collisions). */
export function auditSessionId(event: HookEvent): string {
  return `cc-${event.session_id || 'unknown'}`;
}

/** Extract a file path from tool input for path-policy checks. */
function targetPath(event: HookEvent): string | undefined {
  const input = event.tool_input || {};
  const candidate = input.file_path ?? input.path ?? input.notebook_path;
  return typeof candidate === 'string' ? candidate : undefined;
}

/**
 * Decide what to do with a PreToolUse event. Pure of process concerns
 * (no stdin/stdout/exit) so it can be tested directly.
 */
export function decidePreToolUse(
  event: HookEvent,
  enforcer: PolicyEnforcer,
  scorer: RiskScorer
): HookDecision {
  const toolName = event.tool_name || 'unknown';
  const labels = labelsForClaudeTool(toolName);
  const permission = strictestPermissionForCapabilityLabels(labels);
  const risk = scorer.assess(toolName, event.tool_input || {}, permission);

  // Prohibited capability: never executable, no matter what
  if (labels.includes('move-money')) {
    return {
      permissionDecision: 'deny',
      reason: `Capability "move-money" is prohibited`,
      risk,
      labels,
      permission,
    };
  }

  // Policy: tool disabled or not in enabled list
  const toolCheck = enforcer.isToolAllowed(toolName);
  if (!toolCheck.allowed) {
    return {
      permissionDecision: 'deny',
      reason: toolCheck.reason || `Tool "${toolName}" blocked by policy`,
      risk,
      labels,
      permission,
    };
  }

  // Policy: write target outside writable scope
  if (labels.includes('write-fs')) {
    const p = targetPath(event);
    if (p) {
      const pathCheck = enforcer.isPathWritable(p);
      if (!pathCheck.allowed) {
        return {
          permissionDecision: 'deny',
          reason: pathCheck.reason || `Path "${p}" not writable by policy`,
          risk,
          labels,
          permission,
        };
      }
    }
  }

  // Escalate to the human: always-ask capability, or red risk score
  if (permission === 'always-ask') {
    return {
      permissionDecision: 'ask',
      reason: `Capability [${labels.join(', ')}] requires explicit approval`,
      risk,
      labels,
      permission,
    };
  }
  if (risk.level === 'red') {
    return {
      permissionDecision: 'ask',
      reason: `Risk score ${risk.score}/100 (red): ${topRiskFactor(risk)}`,
      risk,
      labels,
      permission,
    };
  }

  // Default: no opinion. Log and let Claude Code's own gate run.
  return { risk, labels, permission };
}

function topRiskFactor(risk: RiskAssessment): string {
  const top = [...risk.factors].sort((a, b) => b.weighted - a.weighted)[0];
  return top ? `${top.name} (${top.reason})` : 'no factors';
}

/** Audit action for a decision. */
function actionFor(decision: HookDecision): AuditEntry['action'] {
  if (decision.permissionDecision === 'deny') return 'policy_block';
  return 'execute';
}

/**
 * Handle one hook event end-to-end: resume chain, decide, log, and
 * return the JSON to print to stdout (or null for silent success).
 */
export function handleHookEvent(
  kind: 'pre' | 'post',
  event: HookEvent,
  opts?: { logDir?: string; projectRoot?: string }
): { stdout: string | null; exitCode: number } {
  const logger = AuditLogger.resume(auditSessionId(event), opts?.logDir);
  const toolName = event.tool_name || 'unknown';

  if (kind === 'post') {
    const responseSize =
      event.tool_response !== undefined ? JSON.stringify(event.tool_response).length : 0;
    logger.log({
      tool: toolName,
      action: 'exec_complete',
      args: (event.tool_input as Record<string, unknown>) || {},
      result: `response_bytes=${responseSize}`,
    });
    return { stdout: null, exitCode: 0 };
  }

  const policy = loadPolicy(opts?.projectRoot || event.cwd);
  const enforcer = new PolicyEnforcer(policy, opts?.projectRoot || event.cwd);
  const scorer = new RiskScorer(policy.risk);
  const decision = decidePreToolUse(event, enforcer, scorer);

  logger.log({
    tool: toolName,
    action: actionFor(decision),
    args: (event.tool_input as Record<string, unknown>) || {},
    result: `risk=${decision.risk.score}/${decision.risk.level} labels=[${decision.labels.join(',')}]${decision.permissionDecision ? ` decision=${decision.permissionDecision}` : ''}`,
    reason: decision.reason,
  });

  if (decision.permissionDecision) {
    const out = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision.permissionDecision,
        permissionDecisionReason: `[agenttrail] ${decision.reason}`,
      },
    };
    return { stdout: JSON.stringify(out), exitCode: 0 };
  }
  return { stdout: null, exitCode: 0 };
}

// ── settings.json wiring ────────────────────────────────────────────────

const HOOK_MARKER = 'agenttrail hook';

interface HookCommandSpec {
  type: 'command';
  command: string;
}
interface HookMatcherSpec {
  matcher?: string;
  hooks: HookCommandSpec[];
}

/**
 * Idempotently wire agenttrail into a Claude Code settings.json.
 * Returns what changed. Existing hooks and settings are preserved.
 */
export function initClaudeSettings(projectRoot: string): {
  settingsPath: string;
  changed: boolean;
  alreadyInstalled: boolean;
} {
  const settingsDir = path.join(projectRoot, '.claude');
  const settingsPath = path.join(settingsDir, 'settings.json');

  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    // Parse errors propagate: silently rewriting a corrupt settings file
    // would destroy user configuration.
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  }

  const hooks = (settings.hooks as Record<string, HookMatcherSpec[]>) || {};
  const hasOurHook = (specs: HookMatcherSpec[] | undefined): boolean =>
    !!specs?.some((s) => s.hooks?.some((h) => h.command?.includes(HOOK_MARKER)));

  const preInstalled = hasOurHook(hooks.PreToolUse);
  const postInstalled = hasOurHook(hooks.PostToolUse);
  if (preInstalled && postInstalled) {
    return { settingsPath, changed: false, alreadyInstalled: true };
  }

  if (!preInstalled) {
    hooks.PreToolUse = [
      ...(hooks.PreToolUse || []),
      { hooks: [{ type: 'command', command: 'agenttrail hook pre' }] },
    ];
  }
  if (!postInstalled) {
    hooks.PostToolUse = [
      ...(hooks.PostToolUse || []),
      { hooks: [{ type: 'command', command: 'agenttrail hook post' }] },
    ];
  }
  settings.hooks = hooks;

  fs.mkdirSync(settingsDir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return { settingsPath, changed: true, alreadyInstalled: false };
}
