/**
 * Vendored types for the standalone trail package.
 *
 * These began life in codebot-ai (`src/types.ts` and
 * `src/constitutional/types.ts`). They are duplicated here — not imported —
 * so this package has zero coupling to the agent that spawned it. Any
 * agent-side change to these shapes is a spec-version event, not a silent
 * drift.
 */

/**
 * Capability labels a tool/action can declare. Policy gating and the
 * allowlist key off these.
 */
export type CapabilityLabel =
  | 'read-only'
  | 'write-fs'
  | 'run-cmd'
  | 'browser-read'
  | 'browser-write'
  | 'net-fetch'
  | 'account-access'
  | 'send-on-behalf' // always-ask
  | 'delete-data' // always-ask
  | 'spend-money' // always-ask + preview required
  | 'move-money'; // PROHIBITED — actions with this label must not be executable

/** Decision levels from a constitutional/guardrails evaluation. */
export type CordDecision = 'ALLOW' | 'CONTAIN' | 'CHALLENGE' | 'BLOCK';

/** Individual patrol alert attached to a constitutional evaluation. */
export interface VigilAlert {
  type: 'pattern' | 'canary' | 'behavioral' | 'proactive' | 'memory';
  severity: number;
  message: string;
  category: string;
}

/**
 * Result of a constitutional evaluation. Risk scoring accepts this as an
 * optional input factor; no constitutional engine is required at runtime.
 */
export interface ConstitutionalResult {
  decision: CordDecision;
  score: number;
  hardBlock: boolean;
  hardBlockReason?: string;
  dimensions: Record<string, number>;
  explanation: string;
  vigilAlerts: VigilAlert[];
}
