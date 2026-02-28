import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { maskSecretsInString } from './secrets';

/**
 * Audit logger for CodeBot.
 *
 * Provides append-only JSONL logging of all security-relevant actions.
 * Logs are stored at ~/.codebot/audit/audit-YYYY-MM-DD.jsonl
 * Masks secrets in args before writing.
 * NEVER throws — audit failures must not crash the agent.
 */

export interface AuditEntry {
  timestamp: string;
  sessionId: string;
  tool: string;
  action: 'execute' | 'deny' | 'error' | 'security_block';
  args: Record<string, unknown>;
  result?: string;
  reason?: string;
}

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB before rotation
const MAX_ARG_LENGTH = 500; // Truncate long arg values for logging

export class AuditLogger {
  private logDir: string;
  private sessionId: string;

  constructor(logDir?: string) {
    this.logDir = logDir || path.join(os.homedir(), '.codebot', 'audit');
    this.sessionId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    try {
      fs.mkdirSync(this.logDir, { recursive: true });
    } catch {
      // Can't create dir — logging will be disabled
    }
  }

  /** Get the current session ID */
  getSessionId(): string {
    return this.sessionId;
  }

  /** Append an audit entry to the log file */
  log(entry: Omit<AuditEntry, 'timestamp' | 'sessionId'>): void {
    try {
      const fullEntry: AuditEntry = {
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId,
        ...entry,
        args: this.sanitizeArgs(entry.args),
      };

      const logFile = this.getLogFilePath();
      const line = JSON.stringify(fullEntry) + '\n';

      // Check if rotation is needed
      this.rotateIfNeeded(logFile);

      fs.appendFileSync(logFile, line, 'utf-8');
    } catch {
      // Audit failures must NEVER crash the agent
    }
  }

  /** Read log entries, optionally filtered */
  query(filter?: { tool?: string; action?: string; since?: string }): AuditEntry[] {
    const entries: AuditEntry[] = [];
    try {
      const files = fs.readdirSync(this.logDir)
        .filter(f => f.startsWith('audit-') && f.endsWith('.jsonl'))
        .sort();

      for (const file of files) {
        const content = fs.readFileSync(path.join(this.logDir, file), 'utf-8');
        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line) as AuditEntry;
            if (filter?.tool && entry.tool !== filter.tool) continue;
            if (filter?.action && entry.action !== filter.action) continue;
            if (filter?.since && entry.timestamp < filter.since) continue;
            entries.push(entry);
          } catch { /* skip malformed */ }
        }
      }
    } catch {
      // Can't read logs
    }
    return entries;
  }

  /** Get the path to today's log file */
  private getLogFilePath(): string {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(this.logDir, `audit-${date}.jsonl`);
  }

  /** Rotate log file if it exceeds MAX_LOG_SIZE */
  private rotateIfNeeded(logFile: string): void {
    try {
      if (!fs.existsSync(logFile)) return;
      const stat = fs.statSync(logFile);
      if (stat.size >= MAX_LOG_SIZE) {
        const rotated = logFile.replace('.jsonl', `-${Date.now()}.jsonl`);
        fs.renameSync(logFile, rotated);
      }
    } catch {
      // Rotation failure is non-fatal
    }
  }

  /** Sanitize args for logging: mask secrets and truncate long values */
  private sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string') {
        let masked = maskSecretsInString(value);
        if (masked.length > MAX_ARG_LENGTH) {
          masked = masked.substring(0, MAX_ARG_LENGTH) + `... (${value.length} chars)`;
        }
        sanitized[key] = masked;
      } else if (typeof value === 'object' && value !== null) {
        // For objects/arrays, stringify and mask
        const str = JSON.stringify(value);
        const masked = maskSecretsInString(str);
        sanitized[key] = masked.length > MAX_ARG_LENGTH
          ? masked.substring(0, MAX_ARG_LENGTH) + '...'
          : masked;
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
}
