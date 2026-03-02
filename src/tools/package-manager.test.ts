import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PackageManagerTool } from './package-manager';

/**
 * PackageManagerTool tests — validates package name sanitization, action
 * routing, detection logic, error messages, and metadata.
 * Tests use temp directories with lock files to control detection.
 * Tests do NOT run actual install/add/remove commands.
 */

const TEST_ROOT = path.join(os.tmpdir(), 'codebot-pkgmgr-test-' + Date.now());

function ensureTestDir(): void {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
}

function cleanTestDir(): void {
  if (fs.existsSync(TEST_ROOT)) {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  }
}

describe('PackageManagerTool — metadata', () => {
  const tool = new PackageManagerTool();

  it('has correct tool name', () => {
    assert.strictEqual(tool.name, 'package_manager');
  });

  it('has prompt permission level', () => {
    assert.strictEqual(tool.permission, 'prompt');
  });

  it('requires action parameter', () => {
    const required = tool.parameters.required as string[];
    assert.ok(required.includes('action'));
  });

  it('has description mentioning dependency management', () => {
    assert.ok(tool.description.includes('dependencies') || tool.description.includes('Manage'));
  });
});

describe('PackageManagerTool — input validation', () => {
  const tool = new PackageManagerTool();

  before(() => {
    ensureTestDir();
  });

  after(() => {
    // cleanup handled by other describe blocks
  });

  it('returns error when action is missing', async () => {
    const result = await tool.execute({});
    assert.ok(result.includes('Error: action is required'));
  });

  it('returns error for unknown action', async () => {
    // Must provide a cwd with a package.json so detection passes,
    // otherwise the "no package manager detected" error fires first.
    const dir = path.join(TEST_ROOT, 'unknown-action-test');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf-8');
    const result = await tool.execute({ action: 'deploy', cwd: dir });
    assert.ok(result.includes('Error: unknown action'));
    assert.ok(result.includes('deploy'));
    assert.ok(result.includes('install, add, remove'));
  });
});

describe('PackageManagerTool — detect action', () => {
  const tool = new PackageManagerTool();

  before(() => {
    ensureTestDir();
  });

  after(() => {
    cleanTestDir();
  });

  it('detects npm when package.json exists', async () => {
    const dir = path.join(TEST_ROOT, 'npm-project');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf-8');
    const result = await tool.execute({ action: 'detect', cwd: dir });
    assert.ok(result.includes('Detected: npm'));
  });

  it('detects yarn when yarn.lock exists', async () => {
    const dir = path.join(TEST_ROOT, 'yarn-project');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'yarn.lock'), '', 'utf-8');
    const result = await tool.execute({ action: 'detect', cwd: dir });
    assert.ok(result.includes('Detected: yarn'));
  });

  it('detects pnpm when pnpm-lock.yaml exists', async () => {
    const dir = path.join(TEST_ROOT, 'pnpm-project');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '', 'utf-8');
    const result = await tool.execute({ action: 'detect', cwd: dir });
    assert.ok(result.includes('Detected: pnpm'));
  });

  it('detects pip when requirements.txt exists', async () => {
    const dir = path.join(TEST_ROOT, 'pip-project');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'requirements.txt'), '', 'utf-8');
    const result = await tool.execute({ action: 'detect', cwd: dir });
    assert.ok(result.includes('Detected: pip'));
  });

  it('detects cargo when Cargo.toml exists', async () => {
    const dir = path.join(TEST_ROOT, 'cargo-project');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'Cargo.toml'), '', 'utf-8');
    const result = await tool.execute({ action: 'detect', cwd: dir });
    assert.ok(result.includes('Detected: cargo'));
  });

  it('detects go when go.mod exists', async () => {
    const dir = path.join(TEST_ROOT, 'go-project');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'go.mod'), '', 'utf-8');
    const result = await tool.execute({ action: 'detect', cwd: dir });
    assert.ok(result.includes('Detected: go'));
  });

  it('returns "No package manager detected" for empty dir', async () => {
    const dir = path.join(TEST_ROOT, 'empty-project');
    fs.mkdirSync(dir, { recursive: true });
    const result = await tool.execute({ action: 'detect', cwd: dir });
    assert.ok(result.includes('No package manager detected'));
  });

  it('uses forced manager when specified', async () => {
    const dir = path.join(TEST_ROOT, 'forced-project');
    fs.mkdirSync(dir, { recursive: true });
    const result = await tool.execute({ action: 'detect', cwd: dir, manager: 'yarn' });
    assert.ok(result.includes('Detected: yarn'));
  });
});

describe('PackageManagerTool — add action requires package name', () => {
  const tool = new PackageManagerTool();

  before(() => {
    ensureTestDir();
  });

  after(() => {
    cleanTestDir();
  });

  it('returns error when package name is missing for add', async () => {
    const dir = path.join(TEST_ROOT, 'add-no-pkg');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf-8');
    const result = await tool.execute({ action: 'add', cwd: dir });
    assert.ok(result.includes('Error: package name is required for add'));
  });

  it('returns error when package name is missing for remove', async () => {
    const dir = path.join(TEST_ROOT, 'remove-no-pkg');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf-8');
    const result = await tool.execute({ action: 'remove', cwd: dir });
    assert.ok(result.includes('Error: package name is required for remove'));
  });

  it('returns error when no package manager is detected for non-detect actions', async () => {
    const dir = path.join(TEST_ROOT, 'no-mgr');
    fs.mkdirSync(dir, { recursive: true });
    const result = await tool.execute({ action: 'install', cwd: dir });
    assert.ok(result.includes('Error: no package manager detected'));
  });
});

describe('PackageManagerTool — malicious package name blocking', () => {
  const tool = new PackageManagerTool();

  before(() => {
    ensureTestDir();
  });

  after(() => {
    cleanTestDir();
  });

  function makeNpmDir(name: string): string {
    const dir = path.join(TEST_ROOT, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf-8');
    return dir;
  }

  it('blocks package name with semicolon (shell injection)', async () => {
    const dir = makeNpmDir('inject-semicolon');
    const result = await tool.execute({
      action: 'add',
      cwd: dir,
      package: 'lodash; rm -rf /',
    });
    assert.ok(result.includes('Error: invalid package name'));
  });

  it('blocks package name with pipe (shell injection)', async () => {
    const dir = makeNpmDir('inject-pipe');
    const result = await tool.execute({
      action: 'add',
      cwd: dir,
      package: 'lodash | cat /etc/passwd',
    });
    assert.ok(result.includes('Error: invalid package name'));
  });

  it('blocks package name with backticks (command substitution)', async () => {
    const dir = makeNpmDir('inject-backtick');
    const result = await tool.execute({
      action: 'add',
      cwd: dir,
      package: '`rm -rf /`',
    });
    assert.ok(result.includes('Error: invalid package name'));
  });

  it('blocks package name with $() (command substitution)', async () => {
    const dir = makeNpmDir('inject-dollar');
    const result = await tool.execute({
      action: 'add',
      cwd: dir,
      package: '$(whoami)',
    });
    assert.ok(result.includes('Error: invalid package name'));
  });

  it('allows valid npm package names', async () => {
    const dir = makeNpmDir('valid-pkg');
    // This will fail to actually install, but should pass validation
    const result = await tool.execute({
      action: 'add',
      cwd: dir,
      package: 'lodash',
    });
    assert.ok(!result.includes('Error: invalid package name'));
  });

  it('allows scoped npm package names', async () => {
    const dir = makeNpmDir('valid-scoped');
    const result = await tool.execute({
      action: 'add',
      cwd: dir,
      package: '@types/node',
    });
    assert.ok(!result.includes('Error: invalid package name'));
  });

  it('allows npm package with version specifier', async () => {
    const dir = makeNpmDir('valid-version');
    const result = await tool.execute({
      action: 'add',
      cwd: dir,
      package: 'express@4.18.0',
    });
    assert.ok(!result.includes('Error: invalid package name'));
  });
});
