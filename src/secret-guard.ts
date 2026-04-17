/**
 * Shared secret-detection guard for all write paths (write, edit, batch_edit).
 *
 * P1-3 fix: previously each write tool had an inline `scanForSecrets`
 * call that only warned and still wrote the file. The default policy
 * has `secrets.block_on_detect: true`, so the shipped behavior was
 * inconsistent with the policy — documented as "block", implemented as
 * "warn". This module closes that gap via one helper called from each
 * write path.
 *
 * Contract:
 *   - If policy says block AND secrets are found → return { block: true,
 *     error: "..." } — caller MUST return the error without writing.
 *   - If policy says warn-only OR no secrets → return
 *     { block: false, warning: "..." | "" } — caller writes normally and
 *     optionally appends the warning to its success message.
 *
 * The check is centralized so adding new write paths (or changing policy
 * semantics) requires one edit, not three.
 */

import { scanForSecrets } from './secrets';
import { PolicyEnforcer } from './policy';

export interface SecretGuardResult {
  /** True → caller must refuse the write and return `error`. */
  block: boolean;
  /** Non-empty when secrets were found but not blocked. */
  warning: string;
  /** Populated when block=true; the message to return to the agent. */
  error?: string;
  /** Raw scanner output, useful for logging / audit. */
  secrets: ReturnType<typeof scanForSecrets>;
}

/**
 * Scan `content` for potential secrets and apply the effective policy.
 *
 * `contextLabel` shows up in the warning/error message so the agent
 * knows which file / edit triggered it (e.g. `"src/foo.ts"` or
 * `"batch-edit #3"`).
 *
 * When `policyEnforcer` is undefined we fall back to WARN-ONLY so we
 * never block a standalone use of `WriteFileTool` (e.g. from a unit
 * test) that doesn't have a policy wired up.
 */
export function checkSecretsForWrite(
  content: string,
  policyEnforcer: PolicyEnforcer | undefined,
  contextLabel: string,
): SecretGuardResult {
  const shouldScan = policyEnforcer ? policyEnforcer.shouldScanSecrets() : true;
  if (!shouldScan) {
    return { block: false, warning: '', secrets: [] };
  }

  const secrets = scanForSecrets(content);
  if (secrets.length === 0) {
    return { block: false, warning: '', secrets };
  }

  const summary = secrets
    .map((s) => `  Line ${s.line}: ${s.type} — ${s.snippet}`)
    .join('\n');
  const shouldBlock = policyEnforcer ? policyEnforcer.shouldBlockSecrets() : false;

  if (shouldBlock) {
    const error =
      `Error: Blocked by policy — ${secrets.length} potential secret(s) detected in ${contextLabel}:\n` +
      summary +
      `\n\nThe project policy has secrets.block_on_detect=true. ` +
      `To proceed, either: move the secret into an env var (recommended), ` +
      `adjust secrets.allowed_patterns in your policy, or disable block_on_detect.`;
    return { block: true, error, warning: '', secrets };
  }

  // Warn-only: matches the original UX string format so existing
  // snapshots / user expectations don't break.
  const warning =
    `\n\n⚠️  WARNING: ${secrets.length} potential secret(s) detected:\n` +
    summary +
    '\nConsider using environment variables instead of hardcoding secrets.';
  return { block: false, warning, secrets };
}
