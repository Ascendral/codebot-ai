import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { installProtocol, checkProtocol } from './install';
import { START_MARKER, protocolBlock, PROTOCOL_VERSION } from './protocol-text';

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'askahuman-test-'));
}

describe('installProtocol', () => {
  it('creates CLAUDE.md in an empty project', () => {
    const root = tmpProject();
    try {
      const results = installProtocol(root);
      assert.deepStrictEqual(results, [{ file: 'CLAUDE.md', action: 'created' }]);
      const content = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8');
      assert.ok(content.includes(START_MARKER));
      assert.match(content, /Never say "done" or "working" without showing the output/);
      assert.match(content, /WHAT I WON'T TOLERATE/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('appends to an existing CLAUDE.md without touching its content', () => {
    const root = tmpProject();
    try {
      const existing = '# My project rules\n\nAlways use tabs.\n';
      fs.writeFileSync(path.join(root, 'CLAUDE.md'), existing);
      const results = installProtocol(root);
      assert.strictEqual(results[0].action, 'appended');
      const content = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8');
      assert.ok(content.startsWith(existing), 'existing content preserved byte-for-byte at top');
      assert.ok(content.includes(START_MARKER));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('is idempotent — second run reports already-current, no duplication', () => {
    const root = tmpProject();
    try {
      installProtocol(root);
      const results = installProtocol(root);
      assert.strictEqual(results[0].action, 'already-current');
      const content = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8');
      const occurrences = content.split(START_MARKER).length - 1;
      assert.strictEqual(occurrences, 1, 'protocol block appears exactly once');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('upgrades an older-version block in place, preserving surroundings', () => {
    const root = tmpProject();
    try {
      const oldBlock = protocolBlock().replace(`v${PROTOCOL_VERSION} START`, 'v0 START');
      fs.writeFileSync(
        path.join(root, 'CLAUDE.md'),
        `# Header stays\n\n${oldBlock}\n\n# Footer stays\n`
      );
      const results = installProtocol(root);
      assert.strictEqual(results[0].action, 'updated');
      const content = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8');
      assert.ok(content.includes('# Header stays'));
      assert.ok(content.includes('# Footer stays'));
      assert.ok(content.includes(START_MARKER), 'new version installed');
      assert.ok(!content.includes('v0 START'), 'old version gone');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('also installs into .cursorrules and AGENTS.md when they exist', () => {
    const root = tmpProject();
    try {
      fs.writeFileSync(path.join(root, '.cursorrules'), 'use spaces\n');
      fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Agents\n');
      const results = installProtocol(root);
      const files = results.map((r) => r.file).sort();
      assert.deepStrictEqual(files, ['.cursorrules', 'AGENTS.md', 'CLAUDE.md']);
      const cursor = fs.readFileSync(path.join(root, '.cursorrules'), 'utf-8');
      assert.ok(cursor.startsWith('use spaces'), 'cursor rules preserved');
      assert.ok(cursor.includes(START_MARKER));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does NOT create .cursorrules/AGENTS.md when absent', () => {
    const root = tmpProject();
    try {
      installProtocol(root);
      assert.ok(!fs.existsSync(path.join(root, '.cursorrules')));
      assert.ok(!fs.existsSync(path.join(root, 'AGENTS.md')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('checkProtocol', () => {
  it('reports missing → current across an install', () => {
    const root = tmpProject();
    try {
      assert.deepStrictEqual(checkProtocol(root), [{ file: 'CLAUDE.md', status: 'missing' }]);
      installProtocol(root);
      assert.deepStrictEqual(checkProtocol(root), [{ file: 'CLAUDE.md', status: 'current' }]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports outdated for an old-version block', () => {
    const root = tmpProject();
    try {
      const oldBlock = protocolBlock().replace(`v${PROTOCOL_VERSION} START`, 'v0 START');
      fs.writeFileSync(path.join(root, 'CLAUDE.md'), oldBlock);
      assert.deepStrictEqual(checkProtocol(root), [{ file: 'CLAUDE.md', status: 'outdated' }]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('bin/askahuman (the wiring itself, learned the hard way)', () => {
  const bin = path.join(__dirname, '..', 'bin', 'askahuman');

  it('help prints usage through the real bin entry', () => {
    const out = execFileSync(process.execPath, [bin, 'help'], { encoding: 'utf-8' });
    assert.match(out, /install the Protocol/);
    assert.match(out, /askahuman\.help/);
  });

  it('default command installs into cwd via the real bin entry', () => {
    const root = tmpProject();
    try {
      const out = execFileSync(process.execPath, [bin], { encoding: 'utf-8', cwd: root });
      assert.match(out, /CLAUDE\.md — created with the Protocol/);
      assert.ok(fs.existsSync(path.join(root, 'CLAUDE.md')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('check exits 1 in a project without the protocol', () => {
    const root = tmpProject();
    try {
      assert.throws(() =>
        execFileSync(process.execPath, [bin, 'check'], { encoding: 'utf-8', cwd: root, stdio: 'pipe' })
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
