/**
 * agenttrail CLI — init / verify / export / hook
 *
 * Zero dependencies. Hook subcommands read Claude Code event JSON from
 * stdin and must never crash the host agent: all failures degrade to
 * exit 0 with nothing on stdout (fail-open for liveness, but the gap is
 * itself visible because the audit chain will show no entry).
 */

import { AuditLogger } from './audit';
import { exportSarif, sarifToString } from './sarif';
import { handleHookEvent, initClaudeSettings, HookEvent } from './claude-hooks';

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

function listSessions(logger: AuditLogger): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of logger.query()) {
    counts.set(entry.sessionId, (counts.get(entry.sessionId) || 0) + 1);
  }
  return counts;
}

const HELP = `agenttrail — tamper-evident flight recorder for AI agents

Usage:
  agenttrail init                 Wire hooks into ./.claude/settings.json
  agenttrail verify [sessionId]   Verify hash chain(s); exit 1 if broken
  agenttrail sessions             List recorded sessions
  agenttrail export --sarif <sessionId>   SARIF 2.1.0 to stdout
  agenttrail hook pre|post        (called by Claude Code, reads stdin)

State: AGENTTRAIL_HOME (default ~/.agenttrail)
`;

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;

  switch (cmd) {
    case 'init': {
      const result = initClaudeSettings(process.cwd());
      if (result.alreadyInstalled) {
        console.log(`agenttrail hooks already installed in ${result.settingsPath}`);
      } else {
        console.log(`agenttrail hooks written to ${result.settingsPath}`);
        console.log('Every tool call in this repo is now recorded to the audit chain.');
        console.log('Run "agenttrail verify" any time to prove the log is intact.');
      }
      return 0;
    }

    case 'sessions': {
      const logger = new AuditLogger();
      const sessions = listSessions(logger);
      if (sessions.size === 0) {
        console.log('No sessions recorded yet.');
        return 0;
      }
      for (const [sid, count] of sessions) {
        console.log(`${sid}\t${count} entries`);
      }
      return 0;
    }

    case 'verify': {
      const logger = new AuditLogger();
      const target = rest[0];
      const sessions = target ? [target] : [...listSessions(logger).keys()];
      if (sessions.length === 0) {
        console.log('No sessions recorded yet.');
        return 0;
      }
      let anyInvalid = false;
      for (const sid of sessions) {
        const result = logger.verifySession(sid);
        const verdict = result.valid ? 'VALID  ' : 'BROKEN ';
        console.log(
          `${verdict} ${sid}  (${result.entriesChecked} entries)${result.valid ? '' : `  ${result.reason}`}`
        );
        if (!result.valid) anyInvalid = true;
      }
      return anyInvalid ? 1 : 0;
    }

    case 'export': {
      const sarifFlag = rest.indexOf('--sarif');
      const sid = rest.filter((a) => a !== '--sarif')[0];
      if (sarifFlag === -1 || !sid) {
        console.error('Usage: agenttrail export --sarif <sessionId>');
        return 1;
      }
      const logger = new AuditLogger();
      const entries = logger.query({ sessionId: sid });
      if (entries.length === 0) {
        console.error(`No entries for session ${sid}`);
        return 1;
      }
      process.stdout.write(sarifToString(exportSarif(entries)));
      return 0;
    }

    case 'hook': {
      const kind = rest[0];
      if (kind !== 'pre' && kind !== 'post') {
        console.error('Usage: agenttrail hook pre|post');
        return 1;
      }
      try {
        const raw = await readStdin();
        const event = JSON.parse(raw) as HookEvent;
        const { stdout, exitCode } = handleHookEvent(kind, event);
        if (stdout) process.stdout.write(stdout);
        return exitCode;
      } catch {
        // Never crash the host agent. The missing chain entry is the
        // signal that something failed here.
        return 0;
      }
    }

    case 'help':
    case '--help':
    case '-h':
    case undefined: {
      console.log(HELP);
      return 0;
    }

    default: {
      console.error(`Unknown command: ${cmd}\n`);
      console.log(HELP);
      return 1;
    }
  }
}

/* istanbul ignore next — process entry */
if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
