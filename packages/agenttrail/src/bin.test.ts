import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'path';
import { execFileSync } from 'child_process';

/**
 * Regression: the bin shim must actually invoke the CLI.
 *
 * cli.ts runs main() only under `require.main === module`; when the bin
 * shim require()s it, that guard is false, so the shim must call main()
 * itself. First dogfood run (2026-07-09) hit exactly this: `agenttrail
 * sessions` exited 0 with no output. These tests exercise the real bin
 * entry in a child process — not `node dist/cli.js` — so the wiring
 * itself is under test.
 */
describe('bin/agenttrail', () => {
  // __dirname is dist/ at runtime; bin/ sits beside it at the package root
  const bin = path.join(__dirname, '..', 'bin', 'agenttrail');

  it('help prints usage through the bin shim', () => {
    const out = execFileSync(process.execPath, [bin, 'help'], { encoding: 'utf-8' });
    assert.match(out, /agenttrail — tamper-evident flight recorder/);
    assert.match(out, /agenttrail init/);
  });

  it('sessions prints something even when empty', () => {
    const out = execFileSync(process.execPath, [bin, 'sessions'], {
      encoding: 'utf-8',
      env: { ...process.env, AGENTTRAIL_HOME: path.join(__dirname, 'nonexistent-home') },
    });
    assert.match(out, /No sessions recorded yet/);
  });

  it('unknown command exits 1', () => {
    assert.throws(() =>
      execFileSync(process.execPath, [bin, 'bogus'], { encoding: 'utf-8', stdio: 'pipe' })
    );
  });
});
