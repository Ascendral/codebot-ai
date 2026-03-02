import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GlobTool } from './glob';

describe('GlobTool', () => {
  let tool: GlobTool;
  let tmpDir: string;

  before(() => {
    tool = new GlobTool();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glob-test-'));

    // Create test file structure
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'src', 'utils'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), 'export {}');
    fs.writeFileSync(path.join(tmpDir, 'src', 'app.ts'), 'export {}');
    fs.writeFileSync(path.join(tmpDir, 'src', 'style.css'), 'body {}');
    fs.writeFileSync(path.join(tmpDir, 'src', 'utils', 'helper.ts'), 'export {}');
    fs.writeFileSync(path.join(tmpDir, 'docs', 'readme.md'), '# Readme');
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should have correct tool metadata', () => {
    assert.strictEqual(tool.name, 'glob');
    assert.strictEqual(tool.permission, 'auto');
    assert.strictEqual(tool.cacheable, true);
  });

  it('should find TypeScript files with **/*.ts pattern', async () => {
    const result = await tool.execute({ pattern: '**/*.ts', cwd: tmpDir });
    assert.match(result, /index\.ts/);
    assert.match(result, /app\.ts/);
    assert.match(result, /helper\.ts/);
    // Should NOT include CSS or MD
    assert.ok(!result.includes('style.css'));
    assert.ok(!result.includes('readme.md'));
  });

  it('should find files in a specific subdirectory', async () => {
    const result = await tool.execute({ pattern: 'src/*.ts', cwd: tmpDir });
    assert.match(result, /index\.ts/);
    assert.match(result, /app\.ts/);
    // Should NOT include nested file
    assert.ok(!result.includes('helper.ts'));
  });

  it('should find files with globstar in nested dirs', async () => {
    const result = await tool.execute({ pattern: 'src/**/*.ts', cwd: tmpDir });
    // src/**/*.ts must find the nested helper.ts
    assert.match(result, /helper\.ts/);
    // Should find at least one .ts file
    assert.match(result, /\.ts/);
  });

  it('should return "No files found" when no matches', async () => {
    const result = await tool.execute({ pattern: '**/*.xyz', cwd: tmpDir });
    assert.strictEqual(result, 'No files found matching pattern.');
  });

  it('should handle nonexistent cwd gracefully', async () => {
    const result = await tool.execute({ pattern: '**/*.ts', cwd: '/nonexistent/dir/xyz' });
    assert.strictEqual(result, 'No files found matching pattern.');
  });

  it('should find .json files at root level', async () => {
    const result = await tool.execute({ pattern: '*.json', cwd: tmpDir });
    assert.match(result, /package\.json/);
  });

  it('should find markdown files', async () => {
    const result = await tool.execute({ pattern: '**/*.md', cwd: tmpDir });
    assert.match(result, /readme\.md/);
  });

  it('should skip node_modules directory', async () => {
    const nmDir = path.join(tmpDir, 'node_modules', 'pkg');
    fs.mkdirSync(nmDir, { recursive: true });
    fs.writeFileSync(path.join(nmDir, 'index.ts'), 'export {}');

    const result = await tool.execute({ pattern: '**/*.ts', cwd: tmpDir });
    assert.ok(!result.includes('node_modules'));
  });

  it('should handle ? wildcard in pattern', async () => {
    const result = await tool.execute({ pattern: 'src/???.ts', cwd: tmpDir });
    assert.match(result, /app\.ts/);
    assert.ok(!result.includes('index.ts')); // "index" is 5 chars, not 3
  });
});
