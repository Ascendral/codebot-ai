import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CodeAnalysisTool } from './code-analysis';

describe('CodeAnalysisTool', () => {
  let tool: CodeAnalysisTool;
  let tmpDir: string;

  before(() => {
    tool = new CodeAnalysisTool();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-analysis-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should have correct tool metadata', () => {
    assert.strictEqual(tool.name, 'code_analysis');
    assert.strictEqual(tool.permission, 'auto');
    assert.strictEqual(tool.cacheable, true);
  });

  it('should return error when action is missing', async () => {
    const result = await tool.execute({ action: '', path: '/tmp' });
    assert.strictEqual(result, 'Error: action is required');
  });

  it('should return error when path is missing', async () => {
    const result = await tool.execute({ action: 'symbols', path: '' });
    assert.strictEqual(result, 'Error: path is required');
  });

  it('should return error when path does not exist', async () => {
    const result = await tool.execute({ action: 'symbols', path: '/nonexistent/path/xyz' });
    assert.match(result, /Error: path not found/);
  });

  it('should return error for unknown action', async () => {
    const result = await tool.execute({ action: 'foobar', path: tmpDir });
    assert.match(result, /Error: unknown action "foobar"/);
    assert.match(result, /symbols, imports, outline, references/);
  });

  it('should extract class and function symbols from a TypeScript file', async () => {
    const filePath = path.join(tmpDir, 'sample.ts');
    fs.writeFileSync(filePath, [
      'export class MyService {',
      '  async getData(): Promise<string> {',
      '    return "hello";',
      '  }',
      '}',
      '',
      'export function helperFunc(x: number) {',
      '  return x * 2;',
      '}',
      '',
      'export const arrowFn = async (a: string) => {',
      '  return a;',
      '};',
      '',
      'export interface Config {',
      '  name: string;',
      '}',
      '',
      'export type Status = "ok" | "fail";',
    ].join('\n'));

    const result = await tool.execute({ action: 'symbols', path: filePath });
    assert.match(result, /class MyService/);
    assert.match(result, /function helperFunc/);
    assert.match(result, /const arrowFn/);
    assert.match(result, /interface Config/);
    assert.match(result, /type Status/);
    assert.match(result, /method getData/);
  });

  it('should return "No symbols found." for an empty file', async () => {
    const filePath = path.join(tmpDir, 'empty.ts');
    fs.writeFileSync(filePath, '// just a comment\n');

    const result = await tool.execute({ action: 'symbols', path: filePath });
    assert.strictEqual(result, 'No symbols found.');
  });

  it('should extract ES imports', async () => {
    const filePath = path.join(tmpDir, 'imports.ts');
    fs.writeFileSync(filePath, [
      "import * as fs from 'fs';",
      "import { join } from 'path';",
      "const x = require('lodash');",
    ].join('\n'));

    const result = await tool.execute({ action: 'imports', path: filePath });
    assert.match(result, /fs/);
    assert.match(result, /path/);
    assert.match(result, /lodash/);
  });

  it('should return "No imports found." when file has none', async () => {
    const filePath = path.join(tmpDir, 'noimports.ts');
    fs.writeFileSync(filePath, 'const x = 42;\n');

    const result = await tool.execute({ action: 'imports', path: filePath });
    assert.strictEqual(result, 'No imports found.');
  });

  it('should build outline for a directory', async () => {
    const subDir = path.join(tmpDir, 'src_outline');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'index.ts'), 'export class Foo {}');

    const result = await tool.execute({ action: 'outline', path: subDir });
    assert.match(result, /Outline of/);
    assert.match(result, /index\.ts/);
  });

  it('should require symbol arg for references action', async () => {
    const result = await tool.execute({ action: 'references', path: tmpDir });
    assert.strictEqual(result, 'Error: symbol is required for references action');
  });

  it('should find references to a symbol', async () => {
    const refDir = path.join(tmpDir, 'refs');
    fs.mkdirSync(refDir, { recursive: true });
    fs.writeFileSync(path.join(refDir, 'a.ts'), 'const MyThing = 1;\nexport { MyThing };\n');
    fs.writeFileSync(path.join(refDir, 'b.ts'), 'import { MyThing } from "./a";\nconsole.log(MyThing);\n');

    const result = await tool.execute({ action: 'references', path: refDir, symbol: 'MyThing' });
    assert.match(result, /References to "MyThing"/);
    assert.match(result, /a\.ts/);
    assert.match(result, /b\.ts/);
  });

  it('should report no references when symbol is not found', async () => {
    const refDir2 = path.join(tmpDir, 'refs2');
    fs.mkdirSync(refDir2, { recursive: true });
    fs.writeFileSync(path.join(refDir2, 'c.ts'), 'const x = 1;\n');

    const result = await tool.execute({ action: 'references', path: refDir2, symbol: 'NonExistent' });
    assert.match(result, /No references to "NonExistent" found/);
  });
});
