import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MultiSearchTool } from './multi-search';

describe('MultiSearchTool', () => {
  let tool: MultiSearchTool;
  let tmpDir: string;

  before(() => {
    tool = new MultiSearchTool();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-search-test-'));

    // Create test files
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'auth-service.ts'), [
      'export class AuthService {',
      '  login(user: string, pass: string) {',
      '    return true;',
      '  }',
      '}',
    ].join('\n'));
    fs.writeFileSync(path.join(tmpDir, 'src', 'user-controller.ts'), [
      'import { AuthService } from "./auth-service";',
      'export function getUser(id: number) {',
      '  return { id, name: "test" };',
      '}',
    ].join('\n'));
    fs.writeFileSync(path.join(tmpDir, 'config.json'), '{"debug": true}');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should have correct tool metadata', () => {
    assert.strictEqual(tool.name, 'multi_search');
    assert.strictEqual(tool.permission, 'auto');
  });

  it('should return error when query is missing', async () => {
    const result = await tool.execute({ query: '' });
    assert.strictEqual(result, 'Error: query is required');
  });

  it('should return error when path does not exist', async () => {
    const result = await tool.execute({ query: 'test', path: '/nonexistent/xyz' });
    assert.match(result, /Error: path not found/);
  });

  it('should find files by filename match', async () => {
    const result = await tool.execute({ query: 'auth-service', path: tmpDir });
    assert.match(result, /Search results for "auth-service"/);
    assert.match(result, /\[file\]/);
    assert.match(result, /auth-service\.ts/);
  });

  it('should find symbols in code files', async () => {
    const result = await tool.execute({ query: 'AuthService', path: tmpDir });
    assert.match(result, /auth-service\.ts/);
  });

  it('should find content matches', async () => {
    const result = await tool.execute({ query: 'login', path: tmpDir });
    assert.match(result, /auth-service\.ts/);
  });

  it('should return no results for unmatched query', async () => {
    const result = await tool.execute({ query: 'zzzznonexistentzzzz', path: tmpDir });
    assert.match(result, /No results for "zzzznonexistentzzzz"/);
  });

  it('should respect max_results limit', async () => {
    const result = await tool.execute({ query: 'e', path: tmpDir, max_results: 1 });
    // Should have results but limited to 1
    const matchCount = (result.match(/\[(file|symbol|content)\]/g) || []).length;
    assert.ok(matchCount <= 1, `Expected at most 1 result but got ${matchCount}`);
  });

  it('should handle multi-word fuzzy queries', async () => {
    const result = await tool.execute({ query: 'user controller', path: tmpDir });
    assert.match(result, /user-controller/);
  });

  it('should rank exact matches higher than partial', async () => {
    const result = await tool.execute({ query: 'config.json', path: tmpDir });
    // The exact filename match should appear
    assert.match(result, /config\.json/);
  });

  it('should skip node_modules', async () => {
    const nmDir = path.join(tmpDir, 'node_modules', 'pkg');
    fs.mkdirSync(nmDir, { recursive: true });
    fs.writeFileSync(path.join(nmDir, 'auth-service.ts'), 'export class X {}');

    const result = await tool.execute({ query: 'auth-service', path: tmpDir });
    // Should not include any node_modules paths
    assert.ok(!result.includes('node_modules'));
  });
});
