import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GrepTool } from './grep';

describe('GrepTool', () => {
  let tool: GrepTool;
  let tmpDir: string;

  before(() => {
    tool = new GrepTool();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grep-test-'));

    // Create test files
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'main.ts'), [
      'import { readFile } from "fs";',
      'export function hello() {',
      '  console.log("Hello World");',
      '}',
      'export function goodbye() {',
      '  console.log("Goodbye World");',
      '}',
    ].join('\n'));
    fs.writeFileSync(path.join(tmpDir, 'src', 'util.ts'), [
      'export function add(a: number, b: number) {',
      '  return a + b;',
      '}',
    ].join('\n'));
    fs.writeFileSync(path.join(tmpDir, 'data.txt'), 'some plain text\nwith hello in it\n');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should have correct tool metadata', () => {
    assert.strictEqual(tool.name, 'grep');
    assert.strictEqual(tool.permission, 'auto');
    assert.strictEqual(tool.cacheable, true);
  });

  it('should return error when pattern is missing', async () => {
    const result = await tool.execute({ pattern: '', path: tmpDir });
    assert.strictEqual(result, 'Error: pattern is required');
  });

  it('should return error for invalid regex pattern', async () => {
    const result = await tool.execute({ pattern: '[invalid(', path: tmpDir });
    assert.match(result, /Error: invalid regex pattern/);
  });

  it('should return error when path does not exist', async () => {
    const result = await tool.execute({ pattern: 'test', path: '/nonexistent/xyz' });
    assert.match(result, /Error: path not found/);
  });

  it('should find pattern in files across a directory', async () => {
    const result = await tool.execute({ pattern: 'Hello', path: tmpDir });
    assert.match(result, /main\.ts/);
    assert.match(result, /Hello World/);
  });

  it('should search case-insensitively', async () => {
    const result = await tool.execute({ pattern: 'hello', path: tmpDir });
    // The regex is created with 'gi' flags, so it should find Hello
    assert.match(result, /Hello World/);
  });

  it('should return no matches when nothing found', async () => {
    const result = await tool.execute({ pattern: 'zzzznonexistentzzzz', path: tmpDir });
    assert.strictEqual(result, 'No matches found.');
  });

  it('should search a single file when path is a file', async () => {
    const filePath = path.join(tmpDir, 'src', 'main.ts');
    const result = await tool.execute({ pattern: 'function', path: filePath });
    assert.match(result, /hello/);
    assert.match(result, /goodbye/);
  });

  it('should filter by file extension using include', async () => {
    const result = await tool.execute({ pattern: 'hello', path: tmpDir, include: '*.ts' });
    // Should find in .ts files only; data.txt has "hello" too
    assert.match(result, /main\.ts/);
    assert.ok(!result.includes('data.txt'));
  });

  it('should include line numbers in results', async () => {
    const filePath = path.join(tmpDir, 'src', 'main.ts');
    const result = await tool.execute({ pattern: 'console', path: filePath });
    // Lines 3 and 6 have console.log
    assert.match(result, /:3:/);
    assert.match(result, /:6:/);
  });

  it('should skip binary files', async () => {
    const binPath = path.join(tmpDir, 'binary.ts');
    // Create a file with null bytes (binary indicator)
    const buf = Buffer.from('hello\0world');
    fs.writeFileSync(binPath, buf);

    const result = await tool.execute({ pattern: 'hello', path: binPath });
    assert.strictEqual(result, 'No matches found.');
  });

  it('should skip node_modules directory', async () => {
    const nmDir = path.join(tmpDir, 'node_modules', 'pkg');
    fs.mkdirSync(nmDir, { recursive: true });
    fs.writeFileSync(path.join(nmDir, 'index.ts'), 'Hello World from nm');

    const result = await tool.execute({ pattern: 'Hello World from nm', path: tmpDir });
    assert.strictEqual(result, 'No matches found.');
  });
});
