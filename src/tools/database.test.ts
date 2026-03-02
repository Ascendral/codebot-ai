import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import { DatabaseTool } from './database';

/**
 * DatabaseTool tests — validates SQL blocking patterns, input validation,
 * action routing, and error messages. Tests do NOT require sqlite3 or
 * a real database; they test the validation and routing logic only.
 */

describe('DatabaseTool — metadata', () => {
  const tool = new DatabaseTool();

  it('has correct tool name', () => {
    assert.strictEqual(tool.name, 'database');
  });

  it('has prompt permission level', () => {
    assert.strictEqual(tool.permission, 'prompt');
  });

  it('requires action and db parameters', () => {
    const required = tool.parameters.required as string[];
    assert.ok(required.includes('action'));
    assert.ok(required.includes('db'));
  });
});

describe('DatabaseTool — input validation', () => {
  const tool = new DatabaseTool();
  const tempDbForValidation = '/tmp/codebot-test-validation.db';

  before(() => {
    fs.writeFileSync(tempDbForValidation, '', 'utf-8');
  });

  after(() => {
    try { fs.unlinkSync(tempDbForValidation); } catch { /* ignore */ }
  });

  it('returns error when action is missing', async () => {
    const result = await tool.execute({ db: tempDbForValidation });
    assert.ok(result.includes('Error: action is required'));
  });

  it('returns error when db path is missing', async () => {
    const result = await tool.execute({ action: 'query' });
    assert.ok(result.includes('Error: db path is required'));
  });

  it('returns error for nonexistent database file', async () => {
    const result = await tool.execute({ action: 'query', db: '/tmp/nonexistent-db-file-codebot-test.db' });
    assert.ok(result.includes('Error: database not found'));
  });

  it('returns error for unknown action', async () => {
    const result = await tool.execute({ action: 'destroy', db: tempDbForValidation });
    assert.ok(result.includes('Error: unknown action'));
    assert.ok(result.includes('destroy'));
    assert.ok(result.includes('query, tables, schema, info'));
  });
});

describe('DatabaseTool — SQL blocking (destructive queries)', () => {
  const tool = new DatabaseTool();

  // For these tests, the db file must "exist" to get past the fs check,
  // but we only need to test the SQL blocking logic which runs before sqlite3 exec.
  // We create a minimal temp file.
  const tempDbPath = '/tmp/codebot-test-blocking.db';

  // Create a minimal file so fs.existsSync passes
  before(() => {
    fs.writeFileSync(tempDbPath, '', 'utf-8');
  });

  after(() => {
    try { fs.unlinkSync(tempDbPath); } catch { /* ignore */ }
  });

  it('blocks DROP TABLE statements', async () => {
    const result = await tool.execute({
      action: 'query',
      db: tempDbPath,
      sql: 'DROP TABLE users;',
    });
    assert.ok(result.includes('Error: destructive SQL blocked'));
    assert.ok(result.includes('DROP'));
  });

  it('blocks DROP DATABASE statements', async () => {
    const result = await tool.execute({
      action: 'query',
      db: tempDbPath,
      sql: 'DROP DATABASE production;',
    });
    assert.ok(result.includes('Error: destructive SQL blocked'));
  });

  it('blocks DELETE FROM statements', async () => {
    const result = await tool.execute({
      action: 'query',
      db: tempDbPath,
      sql: 'DELETE FROM users WHERE id > 0;',
    });
    assert.ok(result.includes('Error: destructive SQL blocked'));
    assert.ok(result.includes('DELETE'));
  });

  it('blocks TRUNCATE statements', async () => {
    const result = await tool.execute({
      action: 'query',
      db: tempDbPath,
      sql: 'TRUNCATE TABLE sessions;',
    });
    assert.ok(result.includes('Error: destructive SQL blocked'));
    assert.ok(result.includes('TRUNCATE'));
  });

  it('blocks ALTER TABLE ... DROP statements', async () => {
    const result = await tool.execute({
      action: 'query',
      db: tempDbPath,
      sql: 'ALTER TABLE users DROP COLUMN email;',
    });
    assert.ok(result.includes('Error: destructive SQL blocked'));
  });

  it('blocks case-insensitive variations of destructive SQL', async () => {
    const result = await tool.execute({
      action: 'query',
      db: tempDbPath,
      sql: 'drop table users;',
    });
    assert.ok(result.includes('Error: destructive SQL blocked'));
  });

  it('blocks mixed case destructive SQL', async () => {
    const result = await tool.execute({
      action: 'query',
      db: tempDbPath,
      sql: 'Delete From users WHERE 1=1;',
    });
    assert.ok(result.includes('Error: destructive SQL blocked'));
  });

  it('does not block SELECT statements (safe query passes validation)', async () => {
    // This will get past the blocking check but will likely fail on
    // sqlite3 execution (file is not a real db). The key assertion is
    // that the error is NOT about "destructive SQL blocked".
    const result = await tool.execute({
      action: 'query',
      db: tempDbPath,
      sql: 'SELECT * FROM users;',
    });
    assert.ok(!result.includes('destructive SQL blocked'));
  });

  it('does not block SELECT with subqueries', async () => {
    const result = await tool.execute({
      action: 'query',
      db: tempDbPath,
      sql: 'SELECT count(*) FROM (SELECT id FROM users WHERE active=1);',
    });
    assert.ok(!result.includes('destructive SQL blocked'));
  });

  it('returns error when sql is missing for query action', async () => {
    const result = await tool.execute({
      action: 'query',
      db: tempDbPath,
    });
    assert.ok(result.includes('Error: sql is required for query'));
  });
});

describe('DatabaseTool — tables action on nonexistent db', () => {
  const tool = new DatabaseTool();

  it('returns error for tables action on missing db', async () => {
    const result = await tool.execute({
      action: 'tables',
      db: '/tmp/codebot-no-such-database-12345.db',
    });
    assert.ok(result.includes('Error: database not found'));
  });
});
