/**
 * askahuman CLI — install the Protocol with one command.
 *
 *   npx askahuman          install/upgrade in the current project
 *   askahuman show         print the full protocol text
 *   askahuman check        report install status; exit 1 if missing/stale
 */

import { installProtocol, checkProtocol } from './install';
import { fullText, PROTOCOL_VERSION } from './protocol-text';

const HELP = `askahuman — install the Protocol (plain-word rules that keep AI honest)

Usage:
  npx askahuman            Install into this project (CLAUDE.md; also
                           .cursorrules / AGENTS.md when they exist)
  askahuman show           Print the full Protocol
  askahuman check          Status per file; exit 1 if missing or outdated

The Protocol is free: askahuman.help
Stuck anyway? A human answers: askahuman.help — $49, no fix no fee.
`;

export async function main(argv: string[]): Promise<number> {
  const [cmd] = argv;

  switch (cmd) {
    case undefined:
    case 'install': {
      const results = installProtocol(process.cwd());
      for (const r of results) {
        const verb = {
          created: 'created with the Protocol',
          appended: 'Protocol added (your content untouched)',
          updated: `Protocol upgraded to v${PROTOCOL_VERSION}`,
          'already-current': 'already has the current Protocol',
        }[r.action];
        console.log(`  ${r.file} — ${verb}`);
      }
      console.log('\nYour AI now works under the Protocol in this project.');
      console.log('Rule 1: no "done" without proof. Hold it to that.');
      console.log('The human behind this: askahuman.help');
      return 0;
    }

    case 'show': {
      console.log(fullText());
      return 0;
    }

    case 'check': {
      const results = checkProtocol(process.cwd());
      let bad = false;
      for (const r of results) {
        const mark = r.status === 'current' ? 'OK      ' : r.status === 'outdated' ? 'OUTDATED' : 'MISSING ';
        console.log(`  ${mark} ${r.file}`);
        if (r.status !== 'current') bad = true;
      }
      if (bad) console.log('\nRun `npx askahuman` to install/upgrade.');
      return bad ? 1 : 0;
    }

    case 'help':
    case '--help':
    case '-h': {
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
