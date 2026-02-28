import { execSync } from 'child_process';
import * as fs from 'fs';
import { Tool } from '../types';

const BLOCKED_SQL = [
  /\bDROP\s+(TABLE|DATABASE|INDEX|VIEW)\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bTRUNCATE\b/i,
  /\bALTER\s+TABLE\s+.*\bDROP\b/i,
];

export class DatabaseTool implements Tool {
  name = 'database';
  description = 'Query SQLite databases. Actions: query, tables, schema, info. Blocks DROP/DELETE/TRUNCATE for safety.';
  permission: Tool['permission'] = 'prompt';
  parameters = {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Action: query, tables, schema, info' },
      db: { type: 'string', description: 'Path to SQLite database file' },
      sql: { type: 'string', description: 'SQL query to execute (for "query" action)' },
      table: { type: 'string', description: 'Table name (for "schema" action)' },
    },
    required: ['action', 'db'],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const action = args.action as string;
    const dbPath = args.db as string;

    if (!action) return 'Error: action is required';
    if (!dbPath) return 'Error: db path is required';
    if (!fs.existsSync(dbPath)) return `Error: database not found: ${dbPath}`;

    switch (action) {
      case 'query': return this.runQuery(dbPath, args);
      case 'tables': return this.listTables(dbPath);
      case 'schema': return this.showSchema(dbPath, args);
      case 'info': return this.dbInfo(dbPath);
      default: return `Error: unknown action "${action}". Use: query, tables, schema, info`;
    }
  }

  private runQuery(dbPath: string, args: Record<string, unknown>): string {
    const sql = args.sql as string;
    if (!sql) return 'Error: sql is required for query';

    // Block destructive queries
    for (const pattern of BLOCKED_SQL) {
      if (pattern.test(sql)) {
        return `Error: destructive SQL blocked for safety. Pattern matched: ${pattern.source}`;
      }
    }

    return this.sqlite(dbPath, sql);
  }

  private listTables(dbPath: string): string {
    return this.sqlite(dbPath, ".tables");
  }

  private showSchema(dbPath: string, args: Record<string, unknown>): string {
    const table = args.table as string;
    if (table) {
      // Sanitize table name
      if (!/^[a-zA-Z_]\w*$/.test(table)) return 'Error: invalid table name';
      return this.sqlite(dbPath, `.schema ${table}`);
    }
    return this.sqlite(dbPath, ".schema");
  }

  private dbInfo(dbPath: string): string {
    const stat = fs.statSync(dbPath);
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(2);
    const tables = this.sqlite(dbPath, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;");
    return `Database: ${dbPath}\nSize: ${sizeMB} MB\nModified: ${stat.mtime.toISOString()}\n\nTables:\n${tables}`;
  }

  private sqlite(dbPath: string, command: string): string {
    try {
      // Try sqlite3 CLI first
      const output = execSync(`sqlite3 "${dbPath}" "${command.replace(/"/g, '\\"')}"`, {
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output.trim() || '(no results)';
    } catch (err: unknown) {
      const e = err as { stderr?: string };
      const msg = (e.stderr || '').trim();
      if (msg.includes('not found')) {
        return 'Error: sqlite3 is not installed. Install it with: brew install sqlite (macOS) or apt install sqlite3 (Linux)';
      }
      return `Error: ${msg || 'query failed'}`;
    }
  }
}
