import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { CapabilityChecker, CapabilityConfig } from './capabilities';

const PROJECT = '/project';

describe('CapabilityChecker — no restrictions', () => {
  it('allows everything when no capabilities defined for tool', () => {
    const checker = new CapabilityChecker({}, PROJECT);
    assert.deepStrictEqual(checker.checkCapability('execute', 'shell_commands', 'rm -rf /'), { allowed: true });
    assert.deepStrictEqual(checker.checkCapability('write_file', 'fs_write', '/project/src/index.ts'), { allowed: true });
  });

  it('getToolCapabilities returns undefined for unconfigured tools', () => {
    const checker = new CapabilityChecker({}, PROJECT);
    assert.strictEqual(checker.getToolCapabilities('anything'), undefined);
  });
});

describe('CapabilityChecker — shell_commands', () => {
  const config: CapabilityConfig = {
    execute: { shell_commands: ['npm', 'node', 'git', 'tsc'] },
  };
  const checker = new CapabilityChecker(config, PROJECT);

  it('allows commands matching a prefix', () => {
    assert.strictEqual(checker.checkCapability('execute', 'shell_commands', 'npm install').allowed, true);
    assert.strictEqual(checker.checkCapability('execute', 'shell_commands', 'git status').allowed, true);
    assert.strictEqual(checker.checkCapability('execute', 'shell_commands', 'node index.js').allowed, true);
    assert.strictEqual(checker.checkCapability('execute', 'shell_commands', 'tsc').allowed, true);
  });

  it('blocks commands not in allowed list', () => {
    const result = checker.checkCapability('execute', 'shell_commands', 'curl https://evil.com');
    assert.strictEqual(result.allowed, false);
    assert.ok(result.reason?.includes('curl'));
  });

  it('blocks rm commands', () => {
    const result = checker.checkCapability('execute', 'shell_commands', 'rm -rf /');
    assert.strictEqual(result.allowed, false);
    assert.ok(result.reason?.includes('rm'));
  });

  it('allows exact command match (no args)', () => {
    assert.strictEqual(checker.checkCapability('execute', 'shell_commands', 'npm').allowed, true);
  });

  it('does not match partial prefixes', () => {
    // "gits" should not match "git"
    assert.strictEqual(checker.checkCapability('execute', 'shell_commands', 'gits foo').allowed, false);
  });
});

describe('CapabilityChecker — fs_write', () => {
  const config: CapabilityConfig = {
    write_file: { fs_write: ['./src/**', './tests/**'] },
  };
  const checker = new CapabilityChecker(config, PROJECT);

  it('allows writes to matching glob paths', () => {
    assert.strictEqual(checker.checkCapability('write_file', 'fs_write', '/project/src/index.ts').allowed, true);
    assert.strictEqual(checker.checkCapability('write_file', 'fs_write', '/project/tests/foo.test.ts').allowed, true);
    assert.strictEqual(checker.checkCapability('write_file', 'fs_write', '/project/src/deep/nested/file.ts').allowed, true);
  });

  it('blocks writes outside allowed paths', () => {
    const result = checker.checkCapability('write_file', 'fs_write', '/project/docs/readme.md');
    assert.strictEqual(result.allowed, false);
    assert.ok(result.reason?.includes('docs'));
  });

  it('allows paths outside project (handled by security.ts)', () => {
    // Paths outside project root are not restricted by capabilities — security.ts handles them
    assert.strictEqual(checker.checkCapability('write_file', 'fs_write', '/tmp/foo.txt').allowed, true);
  });
});

describe('CapabilityChecker — fs_read', () => {
  const config: CapabilityConfig = {
    read_file: { fs_read: ['./src/**', './package.json'] },
  };
  const checker = new CapabilityChecker(config, PROJECT);

  it('allows reads from matching paths', () => {
    assert.strictEqual(checker.checkCapability('read_file', 'fs_read', '/project/src/index.ts').allowed, true);
    assert.strictEqual(checker.checkCapability('read_file', 'fs_read', '/project/package.json').allowed, true);
  });

  it('blocks reads outside allowed paths', () => {
    const result = checker.checkCapability('read_file', 'fs_read', '/project/.env');
    assert.strictEqual(result.allowed, false);
  });
});

describe('CapabilityChecker — net_access', () => {
  it('blocks all domains when empty array', () => {
    const checker = new CapabilityChecker({ web_fetch: { net_access: [] } }, PROJECT);
    const result = checker.checkCapability('web_fetch', 'net_access', 'example.com');
    assert.strictEqual(result.allowed, false);
    assert.ok(result.reason?.includes('no allowed'));
  });

  it('allows listed domains', () => {
    const checker = new CapabilityChecker({ web_fetch: { net_access: ['github.com', 'npmjs.com'] } }, PROJECT);
    assert.strictEqual(checker.checkCapability('web_fetch', 'net_access', 'github.com').allowed, true);
    assert.strictEqual(checker.checkCapability('web_fetch', 'net_access', 'npmjs.com').allowed, true);
  });

  it('allows subdomains of listed domains', () => {
    const checker = new CapabilityChecker({ web_fetch: { net_access: ['github.com'] } }, PROJECT);
    assert.strictEqual(checker.checkCapability('web_fetch', 'net_access', 'api.github.com').allowed, true);
    assert.strictEqual(checker.checkCapability('web_fetch', 'net_access', 'raw.github.com').allowed, true);
  });

  it('blocks unlisted domains', () => {
    const checker = new CapabilityChecker({ web_fetch: { net_access: ['github.com'] } }, PROJECT);
    const result = checker.checkCapability('web_fetch', 'net_access', 'evil.com');
    assert.strictEqual(result.allowed, false);
  });

  it('allows everything with wildcard', () => {
    const checker = new CapabilityChecker({ web_fetch: { net_access: ['*'] } }, PROJECT);
    assert.strictEqual(checker.checkCapability('web_fetch', 'net_access', 'anything.com').allowed, true);
  });

  it('unrestricted when net_access is undefined', () => {
    const checker = new CapabilityChecker({ web_fetch: {} }, PROJECT);
    assert.strictEqual(checker.checkCapability('web_fetch', 'net_access', 'anything.com').allowed, true);
  });
});

describe('CapabilityChecker — max_output_kb', () => {
  const checker = new CapabilityChecker({ execute: { max_output_kb: 100 } }, PROJECT);

  it('allows output within limit', () => {
    assert.strictEqual(checker.checkCapability('execute', 'max_output_kb', 50).allowed, true);
    assert.strictEqual(checker.checkCapability('execute', 'max_output_kb', 100).allowed, true);
  });

  it('blocks output exceeding limit', () => {
    const result = checker.checkCapability('execute', 'max_output_kb', 200);
    assert.strictEqual(result.allowed, false);
    assert.ok(result.reason?.includes('200KB'));
    assert.ok(result.reason?.includes('100KB'));
  });
});

describe('CapabilityChecker — glob matching', () => {
  it('matches ** for any depth', () => {
    const checker = new CapabilityChecker({ w: { fs_write: ['src/**'] } }, PROJECT);
    assert.strictEqual(checker.checkCapability('w', 'fs_write', '/project/src/a.ts').allowed, true);
    assert.strictEqual(checker.checkCapability('w', 'fs_write', '/project/src/deep/nested/b.ts').allowed, true);
  });

  it('matches * for single segment', () => {
    const checker = new CapabilityChecker({ w: { fs_write: ['src/*.ts'] } }, PROJECT);
    assert.strictEqual(checker.checkCapability('w', 'fs_write', '/project/src/index.ts').allowed, true);
    // * should not match across /
    assert.strictEqual(checker.checkCapability('w', 'fs_write', '/project/src/deep/index.ts').allowed, false);
  });

  it('exact file match', () => {
    const checker = new CapabilityChecker({ w: { fs_write: ['package.json'] } }, PROJECT);
    assert.strictEqual(checker.checkCapability('w', 'fs_write', '/project/package.json').allowed, true);
    assert.strictEqual(checker.checkCapability('w', 'fs_write', '/project/other.json').allowed, false);
  });
});
