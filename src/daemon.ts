/**
 * Persistent Daemon Mode for CodeBot.
 *
 * `codebot --daemon` starts an always-on background agent that:
 *   - Monitors the repo for file changes
 *   - Runs scheduled routines
 *   - Processes a job queue
 *   - Self-monitors health every 5 minutes
 *   - Handles SIGTERM/SIGINT for graceful shutdown
 *
 * All actions go through CORD constitutional safety layer.
 * PID file prevents duplicate daemons.
 */

import * as fs from 'fs';
import * as path from 'path';
import { codebotPath } from './paths';
import { SelfMonitor } from './self-monitor';
import { DaemonLog } from './daemon-log';

// ── Types ──

export type DaemonState = 'starting' | 'running' | 'idle' | 'processing' | 'stopping' | 'stopped';

export interface DaemonJob {
  id: string;
  type: 'routine' | 'file_change' | 'health_check' | 'user_task';
  description: string;
  payload: Record<string, unknown>;
  priority: number; // 0 = highest
  createdAt: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
}

export interface DaemonConfig {
  /** Tick interval in ms (default 30s) */
  tickIntervalMs: number;
  /** Health check interval in ms (default 5 min) */
  healthIntervalMs: number;
  /** Max idle time before exponential backoff starts (default 2 min) */
  idleThresholdMs: number;
  /** Max backoff interval in ms (default 5 min) */
  maxBackoffMs: number;
  /** Whether to watch for file changes */
  watchFiles: boolean;
  /** Max concurrent jobs */
  maxConcurrentJobs: number;
}

const DEFAULT_CONFIG: DaemonConfig = {
  tickIntervalMs: 30_000,
  healthIntervalMs: 5 * 60_000,
  idleThresholdMs: 2 * 60_000,
  maxBackoffMs: 5 * 60_000,
  watchFiles: true,
  maxConcurrentJobs: 1,
};

// ── Daemon ──

export class Daemon {
  private config: DaemonConfig;
  private state: DaemonState = 'stopped';
  private monitor: SelfMonitor;
  private log: DaemonLog;
  private jobQueue: DaemonJob[] = [];
  private activeJobs: Map<string, DaemonJob> = new Map();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private fileWatcher: fs.FSWatcher | null = null;
  private lastActivityTime: number = Date.now();
  private currentBackoffMs: number;
  private idCounter = 0;

  /** Callback for executing a job — injected by the agent */
  onExecuteJob?: (job: DaemonJob) => Promise<string>;

  constructor(config?: Partial<DaemonConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentBackoffMs = this.config.tickIntervalMs;
    this.monitor = new SelfMonitor();
    this.log = new DaemonLog();
  }

  /** Start the daemon */
  async start(): Promise<void> {
    if (this.state !== 'stopped') {
      throw new Error(`Daemon is already ${this.state}`);
    }

    this.state = 'starting';
    this.log.info('Daemon starting');

    // Write PID file
    this.writePidFile();

    // Load pending jobs from disk
    this.loadJobQueue();

    // Start tick timer
    this.tickTimer = setInterval(() => this.tick(), this.config.tickIntervalMs);

    // Start health check timer
    this.healthTimer = setInterval(() => this.healthTick(), this.config.healthIntervalMs);

    // Set up signal handlers
    this.setupSignalHandlers();

    // Start file watcher if enabled
    if (this.config.watchFiles) {
      this.startFileWatcher();
    }

    this.state = 'running';
    this.log.info('Daemon running');

    // Initial health check
    this.healthTick();
  }

  /** Stop the daemon gracefully */
  async stop(): Promise<void> {
    if (this.state === 'stopped') return;

    this.state = 'stopping';
    this.log.info('Daemon stopping');

    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }

    // Persist remaining jobs
    this.saveJobQueue();

    // Remove PID file
    this.removePidFile();

    this.state = 'stopped';
    this.log.info('Daemon stopped');
  }

  /** Get current daemon state */
  getState(): DaemonState {
    return this.state;
  }

  /** Get the job queue */
  getJobQueue(): DaemonJob[] {
    return [...this.jobQueue];
  }

  /** Get active jobs */
  getActiveJobs(): DaemonJob[] {
    return [...this.activeJobs.values()];
  }

  /** Enqueue a new job */
  enqueue(type: DaemonJob['type'], description: string, payload: Record<string, unknown> = {}, priority = 5): DaemonJob {
    const job: DaemonJob = {
      id: `job_${++this.idCounter}_${Date.now().toString(36)}`,
      type,
      description,
      payload,
      priority,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };

    this.jobQueue.push(job);
    this.jobQueue.sort((a, b) => a.priority - b.priority);
    this.saveJobQueue();
    this.log.info(`Job enqueued: ${description} (${type})`);

    return job;
  }

  /** Get the self-monitor */
  getSelfMonitor(): SelfMonitor {
    return this.monitor;
  }

  /** Get the daemon log */
  getLog(): DaemonLog {
    return this.log;
  }

  /** Get daemon status summary */
  status(): string {
    const lines = [
      `Daemon: ${this.state}`,
      `Jobs: ${this.jobQueue.length} pending, ${this.activeJobs.size} active`,
      `Backoff: ${Math.round(this.currentBackoffMs / 1000)}s`,
      `Uptime: ${this.state === 'running' ? 'active' : 'inactive'}`,
    ];
    return lines.join('\n');
  }

  // ── Internal ──

  private async tick(): Promise<void> {
    if (this.state !== 'running' && this.state !== 'idle') return;

    // Check for pending jobs
    const pendingJobs = this.jobQueue.filter(j => j.status === 'pending');
    if (pendingJobs.length === 0) {
      // Nothing to do — enter idle with backoff
      this.state = 'idle';
      this.applyBackoff();
      return;
    }

    // Reset backoff when work is available
    this.currentBackoffMs = this.config.tickIntervalMs;
    this.lastActivityTime = Date.now();

    // Pick next job
    if (this.activeJobs.size >= this.config.maxConcurrentJobs) return;

    const job = pendingJobs[0];
    await this.executeJob(job);
  }

  private async executeJob(job: DaemonJob): Promise<void> {
    job.status = 'running';
    this.activeJobs.set(job.id, job);
    this.state = 'processing';
    this.log.info(`Executing job: ${job.description}`);

    try {
      if (this.onExecuteJob) {
        job.result = await this.onExecuteJob(job);
      } else {
        job.result = `Job ${job.id} would execute: ${job.description}`;
      }
      job.status = 'completed';
      this.log.info(`Job completed: ${job.description}`);
    } catch (err: unknown) {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
      this.log.error(`Job failed: ${job.description} — ${job.error}`);
    } finally {
      this.activeJobs.delete(job.id);
      // Remove from queue
      this.jobQueue = this.jobQueue.filter(j => j.id !== job.id);
      this.saveJobQueue();
      this.state = 'running';
    }
  }

  private healthTick(): void {
    try {
      const report = this.monitor.runAll();
      if (report.overall !== 'healthy') {
        this.log.warn(`Health: ${report.overall} — ${report.checks.filter(c => c.status !== 'healthy').map(c => c.name).join(', ')}`);

        // Create fix jobs for critical issues
        for (const action of report.fixActions) {
          if (action.risk <= 0.3) {
            this.enqueue('health_check', action.description, { tool: action.tool, args: action.args }, 1);
          }
        }
      }
    } catch (err: unknown) {
      this.log.error(`Health check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private applyBackoff(): void {
    const elapsed = Date.now() - this.lastActivityTime;
    if (elapsed > this.config.idleThresholdMs) {
      this.currentBackoffMs = Math.min(this.currentBackoffMs * 1.5, this.config.maxBackoffMs);
    }
  }

  private startFileWatcher(): void {
    try {
      const watchDir = process.cwd();
      // Only watch src/ if it exists
      const srcDir = path.join(watchDir, 'src');
      if (fs.existsSync(srcDir)) {
        this.fileWatcher = fs.watch(srcDir, { recursive: true }, (eventType, filename) => {
          if (!filename || filename.includes('node_modules') || filename.includes('.git')) return;
          if (filename.endsWith('.ts') || filename.endsWith('.js')) {
            this.log.info(`File changed: ${filename}`);
            this.enqueue('file_change', `File changed: ${filename}`, { file: filename, event: eventType }, 3);
          }
        });
      }
    } catch {
      this.log.warn('File watcher unavailable');
    }
  }

  private setupSignalHandlers(): void {
    const shutdown = () => {
      this.stop().catch(() => {});
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  }

  private writePidFile(): void {
    try {
      const dir = codebotPath('daemon');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(codebotPath('daemon/pid'), String(process.pid));
    } catch { /* best effort */ }
  }

  private removePidFile(): void {
    try {
      const pidFile = codebotPath('daemon/pid');
      if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
    } catch { /* best effort */ }
  }

  private loadJobQueue(): void {
    try {
      const queueFile = codebotPath('daemon/queue.json');
      if (fs.existsSync(queueFile)) {
        this.jobQueue = JSON.parse(fs.readFileSync(queueFile, 'utf-8'));
        // Reset any "running" jobs to pending
        for (const job of this.jobQueue) {
          if (job.status === 'running') job.status = 'pending';
        }
      }
    } catch { /* corrupt queue */ }
  }

  private saveJobQueue(): void {
    try {
      const dir = codebotPath('daemon');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        codebotPath('daemon/queue.json'),
        JSON.stringify(this.jobQueue, null, 2),
      );
    } catch { /* best effort */ }
  }
}

/**
 * Check if a daemon is already running.
 */
export function isDaemonRunning(): boolean {
  try {
    const pidFile = codebotPath('daemon/pid');
    if (!fs.existsSync(pidFile)) return false;
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    // Check if PID is alive
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
