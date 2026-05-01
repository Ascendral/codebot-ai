/**
 * CodingAgentProvider boundary — PR 27 of personal-agent-infrastructure.md.
 *
 * Wraps an external autonomous coding agent (Cursor SDK, Codex, Claude Code,
 * etc.) behind a stable interface. CodeBot owns the mission, the audit chain,
 * the vault, the budget; the provider does the agent labor.
 *
 * This file defines the contract. PR 27 ships only an EchoCodingAgentProvider
 * stub that emits fake events — no external wire yet. PR 28 adds the real
 * CursorAgentProvider on top of this same boundary.
 *
 * Design notes:
 * - TaskSpec is the immutable mission. Anything mutable (status, output) lives
 *   on TaskHandle, never on the spec.
 * - Events are append-only and hash-chained via AuditLogger (action='task_event').
 * - PermissionProfile is the same shape as the §11 capability allowlist so a
 *   task inherits the session's effective capabilities by default.
 * - Provider implementations MUST be pure consumers of TaskSpec. No reading
 *   from process.env, no peeking at the vault directly — credentials arrive
 *   through CodingAgentRegistry.
 */

import type { CapabilityLabel } from '../types';

/** Lifecycle state of a coding-agent task. */
export type TaskStatus =
  | 'queued'      // spec accepted, provider not yet started
  | 'running'     // provider is actively working
  | 'awaiting_approval' // paused on a permission prompt the provider raised
  | 'succeeded'   // terminal: provider reported done with success
  | 'failed'      // terminal: provider errored or returned non-zero
  | 'cancelled';  // terminal: caller cancelled mid-run

/** Per-task permission envelope. Subset of the session capability allowlist. */
export interface PermissionProfile {
  /** Capability labels the task is allowed to invoke without prompting. */
  allow: CapabilityLabel[];
  /** Hard ceiling on tokens or model calls; provider MUST refuse to exceed. */
  budget?: { tokens?: number; calls?: number };
  /** When true, every file write goes through the dashboard approval card. */
  requireApprovalOnWrite?: boolean;
}

/** Immutable mission description. */
export interface TaskSpec {
  /** Caller-supplied identifier; if omitted, registry assigns a uuid. */
  id?: string;
  /** Provider name, must match a registered CodingAgentProvider. */
  provider: string;
  /** Human-readable title shown in audit + Tasks tab. */
  title: string;
  /** The actual ask — natural-language goal handed to the provider. */
  prompt: string;
  /** Working directory the provider should treat as the repo root. */
  cwd: string;
  /** Source-of-truth links (issue URL, PR comment, etc.) for the audit chain. */
  context?: {
    issueUrl?: string;
    prUrl?: string;
    commit?: string;
    /** Free-form: e.g. linked connector audit row hashes. */
    notes?: Record<string, string>;
  };
  /** Permission envelope; defaults to the session's effective allowlist. */
  permissions: PermissionProfile;
}

/** Discriminated union of stream events from a provider. */
export type TaskEvent =
  | { type: 'status'; status: TaskStatus; at: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string; at: string }
  | { type: 'file_change'; path: string; op: 'create' | 'modify' | 'delete'; at: string }
  | { type: 'command'; command: string; cwd?: string; exitCode?: number; at: string }
  | { type: 'approval_request'; capability: CapabilityLabel; preview: string; at: string }
  | { type: 'output'; channel: 'stdout' | 'stderr'; text: string; at: string }
  | { type: 'result'; ok: boolean; summary: string; at: string };

/**
 * Live handle on a running task. AsyncIterable of TaskEvent so callers can
 * stream events to the dashboard without buffering the whole run in memory.
 */
export interface TaskHandle {
  /** Concrete id assigned by the registry. */
  readonly id: string;
  /** Frozen snapshot of the spec the provider received. */
  readonly spec: Readonly<TaskSpec>;
  /** Current status. Updated as events arrive. */
  status(): TaskStatus;
  /** Stream of events from the provider. Completes on terminal status. */
  events(): AsyncIterable<TaskEvent>;
  /** Cancel the task. Provider MUST eventually emit status='cancelled'. */
  cancel(reason: string): Promise<void>;
  /**
   * Resolve the caller's pending approval (PR 21 dashboard card). Throws if
   * no approval is currently awaiting.
   */
  respondToApproval(decision: 'allow' | 'deny', reason?: string): Promise<void>;
}

/**
 * The boundary every coding-agent backend implements.
 *
 * Two phases:
 * 1. validateSpec — synchronous, no side effects, no network. Lets callers
 *    surface bad inputs before any audit row is written.
 * 2. start — accepts a validated spec, returns a live TaskHandle. Provider
 *    is responsible for emitting `status` events as it transitions.
 */
export interface CodingAgentProvider {
  /** Stable identifier, matches TaskSpec.provider. */
  readonly name: string;
  /** Human-readable label for UI. */
  readonly displayName: string;
  /** Capability labels the provider may invoke at runtime. */
  readonly capabilities: CapabilityLabel[];
  /** Vault key the registry should resolve before calling start(). */
  readonly vaultKeyName?: string;

  /** Pure validation. Returns null on success or an error message. */
  validateSpec(spec: TaskSpec): string | null;

  /**
   * Begin the task. Credentials, when needed, are supplied by the registry
   * via the second arg; providers MUST NOT read the vault themselves.
   */
  start(spec: TaskSpec, credential: string | null): Promise<TaskHandle>;
}
