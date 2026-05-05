/**
 * Early-return CLI subcommand handlers extracted from cli.ts:main().
 *
 * Each handler corresponds to one of the early-return branches in the
 * original main() function. Splitting them out drops main()'s cyclomatic
 * complexity from 139 toward the 30 gate.
 *
 * Convention: each handler either returns normally (caller should `return`
 * from main) or calls process.exit() directly. None of them throw.
 */

import { AuditLogger } from '../audit';
import { ReplayProvider, loadSessionForReplay, compareOutputs } from '../replay';
import { VaultManager } from '../vault';
import { Daemon } from '../daemon';
import { Agent } from '../agent';
import { resolveConfig, createProvider } from './config';
import { truncate } from './render';

type ParsedArgs = Record<string, string | boolean>;

// Local color helper — matches cli.ts pattern. Self-contained so this
// module has no dependency back into cli.ts.
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};
function c(text: string, style: keyof typeof C): string {
  return `${C[style]}${text}${C.reset}`;
}

/**
 * `codebot vault list|status|set|delete|rm` subcommand.
 *
 * Reads process.argv directly (sub = argv[3]) so it short-circuits before
 * the agent / banner / network. Real CLI for credential management — the
 * gap that previously left users with no honest way to write secrets to
 * ~/.codebot/vault.json.
 *
 * Returns true if argv[2] === 'vault' (handled, caller should return).
 * Returns false otherwise (caller should continue normal flow).
 *
 * Calls process.exit on error paths.
 */
export function handleVaultSubcommand(): boolean {
  if (process.argv[2] !== 'vault') return false;

  const sub = process.argv[3];
  const vault = new VaultManager();

  if (sub === 'list') {
    const names = vault.list();
    if (names.length === 0) {
      console.log('vault: empty');
    } else {
      console.log(`vault: ${names.length} credential(s)`);
      for (const n of names) console.log(`  - ${n}`);
    }
    return true;
  }

  if (sub === 'status') {
    const s = vault.status();
    console.log(`vault path:      ${s.vaultPath}`);
    console.log(`vault exists:    ${s.vaultExists}`);
    console.log(`key source:      ${s.keySource}`);
    console.log(`credential count: ${s.credentialCount}`);
    return true;
  }

  if (sub === 'delete' || sub === 'rm') {
    const name = process.argv[4];
    if (!name) { console.error('Usage: codebot vault delete <name>'); process.exit(1); }
    const ok = vault.delete(name);
    console.log(ok ? `deleted: ${name}` : `not found: ${name}`);
    return true;
  }

  if (sub === 'set') {
    // Usage: codebot vault set <name> KEY=VALUE
    // Stores the VALUE as the credential string. Connector code reads
    // it via registry.getCredential(name) which returns cred.value
    // directly — single-string contract verified at registry.ts:56.
    const name = process.argv[4];
    const kv = process.argv[5];
    if (!name || !kv || !kv.includes('=')) {
      console.error('Usage: codebot vault set <name> KEY=VALUE');
      console.error('Example: codebot vault set github GITHUB_TOKEN=ghp_xxxxx');
      process.exit(1);
    }
    const eq = kv.indexOf('=');
    const value = kv.slice(eq + 1);
    if (!value) { console.error('Empty value rejected.'); process.exit(1); }
    vault.set(name, {
      type: 'oauth_token',
      value,
      metadata: { provider: name, created: new Date().toISOString() },
    });
    console.log(`stored: ${name} (${value.length} chars, value not echoed)`);
    return true;
  }

  console.error('Usage:');
  console.error('  codebot vault list');
  console.error('  codebot vault status');
  console.error('  codebot vault set <name> KEY=VALUE');
  console.error('  codebot vault delete <name>');
  process.exit(1);
}

/**
 * `--verify-audit [sessionId]` — walks the hash-chain for one or all sessions.
 * Single-session mode runs verify on entries for the given id; full mode
 * groups all entries by sessionId, runs per-session verify, prints a summary
 * with legacy/crashed counts.
 */
export function handleVerifyAudit(args: ParsedArgs): void {
  const logger = new AuditLogger();
  const sessionId = typeof args['verify-audit'] === 'string' ? (args['verify-audit'] as string) : undefined;

  if (sessionId) {
    const entries = logger.query({ sessionId });
    if (entries.length === 0) {
      console.log(c(`No audit entries found for session ${sessionId}`, 'yellow'));
      return;
    }
    const result = AuditLogger.verify(entries);
    if (result.valid) {
      console.log(c(`Audit chain valid (${result.entriesChecked} entries checked)`, 'green'));
    } else {
      console.log(c(`Audit chain INVALID at sequence ${result.firstInvalidAt}`, 'red'));
      console.log(c(`Reason: ${result.reason}`, 'red'));
    }
    return;
  }

  const entries = logger.query();
  if (entries.length === 0) {
    console.log(c('No audit entries found.', 'yellow'));
    return;
  }
  const sessions = new Map<string, typeof entries>();
  for (const e of entries) {
    if (!sessions.has(e.sessionId)) sessions.set(e.sessionId, []);
    sessions.get(e.sessionId)!.push(e);
  }
  let allValid = true;
  let legacySessions = 0;
  let legacyEntries = 0;
  let crashed = 0;
  for (const [sid, sessionEntries] of sessions) {
    const shortId = sid.substring(0, 12);
    let result;
    try {
      result = AuditLogger.verify(sessionEntries);
    } catch (err) {
      crashed++;
      allValid = false;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(c(`  ${shortId}  ERROR: verifier threw: ${msg}`, 'red'));
      continue;
    }
    if (result.valid) {
      console.log(c(`  ${shortId}  ${result.entriesChecked} entries  valid`, 'green'));
    } else if (result.legacy) {
      legacySessions++;
      legacyEntries += sessionEntries.length;
      console.log(c(`  ${shortId}  ${sessionEntries.length} entries  skipped (legacy unhashed)`, 'yellow'));
    } else {
      console.log(c(`  ${shortId}  INVALID at seq ${result.firstInvalidAt}: ${result.reason}`, 'red'));
      allValid = false;
    }
  }
  const verifiable = sessions.size - legacySessions;
  const lines: string[] = [];
  if (legacySessions > 0) {
    lines.push(c(`Skipped ${legacySessions} legacy sessions (${legacyEntries} entries) predating v1.7.0 hash chain.`, 'yellow'));
  }
  if (crashed > 0) {
    lines.push(c(`${crashed} sessions failed to verify due to verifier errors.`, 'red'));
  }
  lines.push(
    allValid
      ? c(`All ${verifiable} hashed session chains verified.`, 'green')
      : c(`Some chains are invalid — possible tampering detected.`, 'red'),
  );
  console.log('\n' + lines.join('\n'));
}

/**
 * `--replay [sessionId]` — re-run a recorded session against a ReplayProvider
 * and report tool-output divergences vs. the original recording.
 */
export async function handleReplay(args: ParsedArgs): Promise<void> {
  // Lazy import to avoid pulling SessionManager into modules that don't need it.
  const { SessionManager } = await import('../history');
  const replayId = typeof args.replay === 'string' ? (args.replay as string) : SessionManager.latest();
  if (!replayId) {
    console.log(c('No session to replay.', 'yellow'));
    return;
  }
  const data = loadSessionForReplay(replayId);
  if (!data) {
    console.log(c(`Session ${replayId} not found.`, 'red'));
    return;
  }
  console.log(c(`\nReplaying session ${replayId.substring(0, 12)}...`, 'cyan'));
  console.log(c(`  ${data.messages.length} messages`, 'dim'));
  const replayProvider = new ReplayProvider(data.assistantMessages);
  const config = await resolveConfig(args);
  const agent = new Agent({
    provider: replayProvider,
    model: config.model,
    providerName: 'replay',
    autoApprove: true,
  });
  const recordedResults = Array.from(data.toolResults.values());
  let resultIndex = 0;
  let divergences = 0;
  for (const userMsg of data.userMessages) {
    console.log(c(`\n> ${truncate(userMsg.content, 100)}`, 'cyan'));
    for await (const event of agent.run(userMsg.content)) {
      if (event.type === 'tool_result' && event.toolResult && !event.toolResult.is_error) {
        const recorded = recordedResults[resultIndex++];
        if (recorded !== undefined) {
          const diff = compareOutputs(recorded, event.toolResult.result);
          if (diff) {
            divergences++;
            console.log(c(`  ⚠ Divergence in ${event.toolResult.name || 'tool'}:`, 'yellow'));
          } else {
            console.log(c(`  ✓ ${event.toolResult.name || 'tool'} — output matches`, 'green'));
          }
        }
      }
    }
  }
  console.log(c(`\n\nReplay complete. ${divergences} divergence(s).`, 'bold'));
}

/**
 * `--daemon` — start the long-running daemon worker. Constructs an Agent
 * from resolved config and a Daemon, wires the execute-job handler,
 * blocks on daemon.start().
 */
export async function handleDaemon(args: ParsedArgs): Promise<void> {
  const config = await resolveConfig(args);
  const provider = createProvider(config);
  const agent = new Agent({
    provider,
    model: config.model,
    providerName: config.provider,
    maxIterations: config.maxIterations,
    autoApprove: true,
    routerConfig: config.router,
    budgetConfig: config.budget,
    allowedCapabilities: config.allowedCapabilities,
    constitutional: { enabled: !config.disableConstitutional },
  });
  const daemon = new Daemon();
  daemon.onExecuteJob = async (job) => {
    let output = '';
    for await (const event of agent.run(job.description)) {
      if (event.type === 'text' && event.text) output += event.text;
    }
    return output || `Completed: ${job.description}`;
  };
  console.log(c('  CodeBot Daemon starting...', 'cyan'));
  console.log(c('  Press Ctrl+C to stop.', 'dim'));
  await daemon.start();
}

