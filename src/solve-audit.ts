/**
 * Solve Audit Trail — structured logging for the solve pipeline.
 *
 * Records every phase, decision, tool call, and outcome into a JSON audit file.
 * Used for: debugging failed solves, PR evidence, CI integration, compliance.
 *
 * Storage: ~/.codebot/audits/solve-<issue#>-<timestamp>.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { codebotPath } from './paths';

export interface AuditEntry {
  timestamp: string;
  phase: string;
  action: string;
  detail?: string;
  durationMs?: number;
  success?: boolean;
  metadata?: Record<string, unknown>;
}

export interface SolveAudit {
  version: '1.0';
  sessionId: string;
  issueUrl: string;
  startedAt: string;
  completedAt?: string;
  outcome?: 'success' | 'failure' | 'timeout' | 'aborted';
  entries: AuditEntry[];
  summary?: {
    totalDurationMs: number;
    phasesCompleted: string[];
    filesModified: string[];
    testsRun: boolean;
    testsPassed: boolean;
    confidence: number;
    risk: string;
    prUrl?: string;
    tokensUsed: number;
    cost: string;
  };
}

export class SolveAuditTrail {
  private audit: SolveAudit;
  private phaseStartTimes = new Map<string, number>();
  private filePath: string;

  constructor(sessionId: string, issueUrl: string) {
    this.audit = {
      version: '1.0',
      sessionId,
      issueUrl,
      startedAt: new Date().toISOString(),
      entries: [],
    };

    const auditsDir = codebotPath('audits');
    if (!fs.existsSync(auditsDir)) {
      fs.mkdirSync(auditsDir, { recursive: true });
    }
    const issueNum = issueUrl.match(/(\d+)\s*$/)?.[1] || 'unknown';
    this.filePath = path.join(auditsDir, `solve-${issueNum}-${Date.now()}.json`);
  }

  /** Record the start of a phase. */
  phaseStart(phase: string, detail?: string): void {
    this.phaseStartTimes.set(phase, Date.now());
    this.addEntry({ phase, action: 'phase_start', detail });
  }

  /** Record the end of a phase with optional duration. */
  phaseEnd(phase: string, detail?: string, success = true): void {
    const startTime = this.phaseStartTimes.get(phase);
    const durationMs = startTime ? Date.now() - startTime : undefined;
    this.addEntry({ phase, action: 'phase_end', detail, durationMs, success });
  }

  /** Record a tool call made by the solve agent. */
  toolCall(phase: string, toolName: string, args?: Record<string, unknown>): void {
    this.addEntry({
      phase,
      action: 'tool_call',
      detail: toolName,
      metadata: args ? { args } : undefined,
    });
  }

  /** Record a decision or notable event. */
  decision(phase: string, description: string, metadata?: Record<string, unknown>): void {
    this.addEntry({ phase, action: 'decision', detail: description, metadata });
  }

  /** Record an error. */
  error(phase: string, message: string, metadata?: Record<string, unknown>): void {
    this.addEntry({ phase, action: 'error', detail: message, success: false, metadata });
  }

  /** Record the self-review result. */
  selfReview(verdict: 'approve' | 'revise' | 'reject', reasoning: string): void {
    this.addEntry({
      phase: 'reviewing',
      action: 'self_review',
      detail: verdict,
      metadata: { reasoning },
    });
  }

  /** Set the final summary. */
  setSummary(summary: SolveAudit['summary']): void {
    this.audit.summary = summary;
  }

  /** Finalize and save the audit trail. */
  finalize(outcome: SolveAudit['outcome']): string {
    this.audit.completedAt = new Date().toISOString();
    this.audit.outcome = outcome;
    this.save();
    return this.filePath;
  }

  /** Get the file path for the audit trail. */
  getFilePath(): string {
    return this.filePath;
  }

  /** Get the raw audit data. */
  getAudit(): Readonly<SolveAudit> {
    return this.audit;
  }

  /** Get a compact text summary for PR bodies. */
  getTextSummary(): string {
    const lines: string[] = [];
    lines.push(`Audit Trail: ${this.audit.entries.length} entries`);

    const phases = [...new Set(this.audit.entries.map(e => e.phase))];
    for (const phase of phases) {
      const phaseEntries = this.audit.entries.filter(e => e.phase === phase);
      const endEntry = phaseEntries.find(e => e.action === 'phase_end');
      const errors = phaseEntries.filter(e => e.action === 'error');
      const duration = endEntry?.durationMs ? ` (${(endEntry.durationMs / 1000).toFixed(1)}s)` : '';
      const status = errors.length > 0 ? '⚠️' : endEntry?.success !== false ? '✅' : '❌';
      lines.push(`  ${status} ${phase}${duration}`);
    }

    return lines.join('\n');
  }

  private addEntry(entry: Omit<AuditEntry, 'timestamp'>): void {
    this.audit.entries.push({
      timestamp: new Date().toISOString(),
      ...entry,
    });
    // Flush periodically (every 10 entries) for crash resilience
    if (this.audit.entries.length % 10 === 0) {
      this.save();
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.audit, null, 2), 'utf-8');
    } catch {
      // Best-effort — don't crash the solve for audit persistence failures
    }
  }
}
