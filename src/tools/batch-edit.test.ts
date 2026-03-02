import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BatchEditTool } from './batch-edit';

/**
 * BatchEditTool tests — validates input validation, path safety,
 * find-and-replace logic, atomicity, and secret detection warnings.
 */

// Use a temp directory under user home for path safety checks to pass
const TEST_ROOT = path.join(os.homedir(), '.codebot', 'test-batch-edit-' + Date.now());

function ensureTestDir(): void {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
}

function cleanTestDir(): void {
  if (fs.existsSync(TEST_ROOT)) {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  }
}

function writeTestFile(name: string, content: string): string {
  const filePath = path.join(TEST_ROOT, name);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

describe('BatchEditTool — input validation', () => {
  const tool = new BatchEditTool();

  it('has correct tool metadata', () => {
    assert.strictEqual(tool.name, 'batch_edit');
    assert.strictEqual(tool.permission, 'prompt');
    assert.ok(tool.description.length > 0);
    assert.strictEqual(tool.parameters.required[0], 'edits');
  });

  it('returns error when edits array is missing', async () => {
    const result = await tool.execute({});
    assert.ok(result.includes('Error: edits array is required'));
  });

  it('returns error when edits array is empty', async () => {
    const result = await tool.execute({ edits: [] });
    assert.ok(result.includes('Error: edits array is required and must not be empty'));
  });

  it('returns error when edits is not an array', async () => {
    const result = await tool.execute({ edits: 'not-an-array' });
    assert.ok(result.includes('Error: edits array is required'));
  });

  it('returns error when edits is null', async () => {
    const result = await tool.execute({ edits: null });
    assert.ok(result.includes('Error: edits array is required'));
  });
});

describe('BatchEditTool — file operations', () => {
  const tool = new BatchEditTool();
  const originalCwd = process.cwd();

  before(() => {
    ensureTestDir();
    // Set cwd to TEST_ROOT so path safety (projectRoot = process.cwd()) passes
    process.chdir(TEST_ROOT);
  });

  after(() => {
    process.chdir(originalCwd);
    cleanTestDir();
  });

  it('returns error when file does not exist', async () => {
    const nonExistent = path.join(TEST_ROOT, 'does-not-exist.txt');
    const result = await tool.execute({
      edits: [{ path: nonExistent, old_string: 'foo', new_string: 'bar' }],
    });
    assert.ok(result.includes('File not found'));
    assert.ok(result.includes('Validation failed'));
  });

  it('returns error when old_string is not found in the file', async () => {
    const filePath = writeTestFile('hello.txt', 'Hello World');
    const result = await tool.execute({
      edits: [{ path: filePath, old_string: 'MISSING_STRING', new_string: 'replacement' }],
    });
    assert.ok(result.includes('String not found'));
    assert.ok(result.includes('Validation failed'));
  });

  it('returns error when old_string appears multiple times', async () => {
    const filePath = writeTestFile('dup.txt', 'foo bar foo baz');
    const result = await tool.execute({
      edits: [{ path: filePath, old_string: 'foo', new_string: 'qux' }],
    });
    assert.ok(result.includes('found 2 times'));
    assert.ok(result.includes('must be unique'));
    assert.ok(result.includes('Validation failed'));
  });

  it('successfully applies a single edit to one file', async () => {
    const filePath = writeTestFile('single.txt', 'Hello World');
    const result = await tool.execute({
      edits: [{ path: filePath, old_string: 'Hello World', new_string: 'Goodbye World' }],
    });
    assert.ok(result.includes('Applied 1 edit'));
    assert.ok(result.includes('1 file'));
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.strictEqual(content, 'Goodbye World');
  });

  it('successfully applies multiple edits across multiple files', async () => {
    const file1 = writeTestFile('multi1.txt', 'alpha beta');
    const file2 = writeTestFile('multi2.txt', 'gamma delta');
    const result = await tool.execute({
      edits: [
        { path: file1, old_string: 'alpha beta', new_string: 'ALPHA BETA' },
        { path: file2, old_string: 'gamma delta', new_string: 'GAMMA DELTA' },
      ],
    });
    assert.ok(result.includes('Applied 2 edits'));
    assert.ok(result.includes('2 files'));
    assert.strictEqual(fs.readFileSync(file1, 'utf-8'), 'ALPHA BETA');
    assert.strictEqual(fs.readFileSync(file2, 'utf-8'), 'GAMMA DELTA');
  });

  it('does not apply any edits when validation fails (atomicity)', async () => {
    const fileGood = writeTestFile('atomic-good.txt', 'good content here');
    const fileBad = path.join(TEST_ROOT, 'nonexistent-atomic.txt');
    const result = await tool.execute({
      edits: [
        { path: fileGood, old_string: 'good content here', new_string: 'modified' },
        { path: fileBad, old_string: 'anything', new_string: 'wont work' },
      ],
    });
    assert.ok(result.includes('Validation failed'));
    // The good file should remain unchanged (no partial application)
    assert.strictEqual(fs.readFileSync(fileGood, 'utf-8'), 'good content here');
  });

  it('warns about secrets in new_string but does not block the edit', async () => {
    const filePath = writeTestFile('secret.txt', 'api_key = "placeholder"');
    const result = await tool.execute({
      edits: [{
        path: filePath,
        old_string: 'api_key = "placeholder"',
        new_string: 'api_key = "AKIA1234567890ABCDEF"',
      }],
    });
    // Should succeed but contain a warning about AWS key
    assert.ok(result.includes('Applied 1 edit'));
    assert.ok(result.includes('Security warnings'));
    assert.ok(result.includes('aws_access_key'));
    // File should still be written
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.ok(content.includes('AKIA1234567890ABCDEF'));
  });

  it('truncates long old_string in error messages', async () => {
    const filePath = writeTestFile('truncate.txt', 'short content');
    const longStr = 'A'.repeat(100);
    const result = await tool.execute({
      edits: [{ path: filePath, old_string: longStr, new_string: 'replacement' }],
    });
    assert.ok(result.includes('...'));
    assert.ok(result.includes('String not found'));
  });
});

describe('BatchEditTool — path safety', () => {
  const tool = new BatchEditTool();
  const originalCwd = process.cwd();

  before(() => {
    ensureTestDir();
    process.chdir(TEST_ROOT);
  });

  after(() => {
    process.chdir(originalCwd);
    cleanTestDir();
  });

  it('blocks edits to system paths like /etc', async () => {
    const result = await tool.execute({
      edits: [{ path: '/etc/passwd', old_string: 'root', new_string: 'hacked' }],
    });
    assert.ok(result.includes('Blocked') || result.includes('Validation failed'));
  });

  it('blocks edits to sensitive home directory files like .ssh', async () => {
    const sshPath = path.join(os.homedir(), '.ssh', 'config');
    const result = await tool.execute({
      edits: [{ path: sshPath, old_string: 'Host', new_string: 'Hacked' }],
    });
    assert.ok(result.includes('Blocked') || result.includes('Validation failed'));
  });
});
