import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CodeReviewTool } from './code-review';

describe('CodeReviewTool', () => {
  let tool: CodeReviewTool;
  let tmpDir: string;

  before(() => {
    tool = new CodeReviewTool();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-review-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should have correct tool metadata', () => {
    assert.strictEqual(tool.name, 'code_review');
    assert.strictEqual(tool.permission, 'auto');
    assert.strictEqual(tool.cacheable, true);
  });

  it('should return error when action is missing', async () => {
    const result = await tool.execute({ action: '', path: '/tmp' });
    assert.strictEqual(result, 'Error: action is required');
  });

  it('should return error when path is missing', async () => {
    const result = await tool.execute({ action: 'security', path: '' });
    assert.strictEqual(result, 'Error: path is required');
  });

  it('should return error when path does not exist', async () => {
    const result = await tool.execute({ action: 'security', path: '/nonexistent/xyz' });
    assert.match(result, /Error: path not found/);
  });

  it('should return error for unknown action', async () => {
    const result = await tool.execute({ action: 'foobar', path: tmpDir });
    assert.match(result, /Error: unknown action "foobar"/);
    assert.match(result, /security, complexity, review/);
  });

  it('should detect eval() security issue', async () => {
    const filePath = path.join(tmpDir, 'unsafe.js');
    fs.writeFileSync(filePath, 'const x = eval("1+1");\n');

    const result = await tool.execute({ action: 'security', path: filePath });
    assert.match(result, /no-eval/);
    assert.match(result, /eval\(\) is a security risk/);
  });

  it('should detect innerHTML assignment', async () => {
    const filePath = path.join(tmpDir, 'xss.js');
    fs.writeFileSync(filePath, 'document.getElementById("app").innerHTML = userInput;\n');

    const result = await tool.execute({ action: 'security', path: filePath });
    assert.match(result, /no-innerhtml/);
  });

  it('should detect hardcoded secrets', async () => {
    const filePath = path.join(tmpDir, 'secrets.ts');
    fs.writeFileSync(filePath, 'const apiKey = "sk-abcdefgh12345678";\n');

    const result = await tool.execute({ action: 'security', path: filePath });
    assert.match(result, /hardcoded-secret/);
  });

  it('should report no issues for clean code', async () => {
    const filePath = path.join(tmpDir, 'clean.ts');
    fs.writeFileSync(filePath, 'export function add(a: number, b: number): number {\n  return a + b;\n}\n');

    const result = await tool.execute({ action: 'security', path: filePath });
    assert.strictEqual(result, 'No security issues found.');
  });

  it('should filter issues by severity level', async () => {
    const filePath = path.join(tmpDir, 'mixed.js');
    fs.writeFileSync(filePath, [
      'eval("bad");',           // error
      'console.log("debug");',  // info
    ].join('\n'));

    // With severity=error, only eval should appear
    const errorOnly = await tool.execute({ action: 'security', path: filePath, severity: 'error' });
    assert.match(errorOnly, /no-eval/);
    assert.ok(!errorOnly.includes('no-console'));

    // With severity=info, both should appear
    const allSeverity = await tool.execute({ action: 'security', path: filePath, severity: 'info' });
    assert.match(allSeverity, /no-eval/);
    assert.match(allSeverity, /no-console/);
  });

  it('should analyze complexity and flag long functions', async () => {
    const filePath = path.join(tmpDir, 'long.ts');
    // Create a function with 55 lines (over the 50-line threshold)
    const lines = ['function longFunction() {'];
    for (let i = 0; i < 53; i++) {
      lines.push(`  const x${i} = ${i};`);
    }
    lines.push('}');
    fs.writeFileSync(filePath, lines.join('\n'));

    const result = await tool.execute({ action: 'complexity', path: filePath });
    assert.match(result, /longFunction/);
    assert.match(result, /lines long/);
  });

  it('should report no complexity issues for simple code', async () => {
    const filePath = path.join(tmpDir, 'simple.ts');
    fs.writeFileSync(filePath, 'function add(a: number, b: number) {\n  return a + b;\n}\n');

    const result = await tool.execute({ action: 'complexity', path: filePath });
    assert.strictEqual(result, 'No complexity issues found.');
  });

  it('should perform full review combining security and complexity', async () => {
    const filePath = path.join(tmpDir, 'full.js');
    fs.writeFileSync(filePath, 'eval("code");\n');

    const result = await tool.execute({ action: 'review', path: filePath });
    assert.match(result, /=== Security Review ===/);
    assert.match(result, /=== Complexity Analysis ===/);
  });
});
