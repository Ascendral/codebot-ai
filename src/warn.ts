/**
 * Non-fatal operational warning helper.
 *
 * Replaces silent catch blocks with controlled, visible warnings.
 * "Best effort" is fine — "best effort and invisible when broken" is not.
 *
 * Output goes to stderr so it doesn't pollute agent output.
 * Can be suppressed with CODEBOT_QUIET=1 for CI/test environments.
 */

let warned = new Set<string>();

/**
 * Emit a non-fatal operational warning to stderr.
 * Deduplicates by context+message to avoid spamming.
 *
 * @param context  Module or operation name (e.g. "history.save", "vault.persist")
 * @param error    The caught error
 */
export function warnNonFatal(context: string, error: unknown): void {
  if (process.env.CODEBOT_QUIET === '1') return;

  const msg = error instanceof Error ? error.message : String(error);
  const key = `${context}:${msg}`;
  if (warned.has(key)) return;
  warned.add(key);

  process.stderr.write(`[codebot:warn] ${context}: ${msg}\n`);
}

/** Reset dedup set (for tests). */
export function resetWarnings(): void {
  warned = new Set();
}
