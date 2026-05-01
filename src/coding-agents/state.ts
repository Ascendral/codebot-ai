/**
 * Durable task state under ~/.codebot/tasks/<task-id>.json.
 *
 * State files survive process restarts so the dashboard Tasks tab can
 * recover after a crash (PR 29). Writes are best-effort and NEVER throw —
 * losing a state file is recoverable from the audit chain.
 */

import * as fs from 'fs';
import * as path from 'path';
import { codebotPath } from '../paths';
import { warnNonFatal } from '../warn';
import type { TaskSpec, TaskStatus, TaskEvent } from './types';

export interface PersistedTask {
  id: string;
  spec: TaskSpec;
  status: TaskStatus;
  startedAt: string;
  endedAt?: string;
  /** Last N events kept inline; full stream lives in audit log. */
  recentEvents: TaskEvent[];
}

const RECENT_EVENT_CAP = 50;

function tasksDir(): string {
  return codebotPath('tasks');
}

function ensureDir(): void {
  try {
    fs.mkdirSync(tasksDir(), { recursive: true });
  } catch (err) {
    warnNonFatal('coding-agents.state.init', err);
  }
}

function fileFor(id: string): string {
  // Sanitize: id MUST be a simple uuid-like string. Reject path separators.
  if (id.includes('/') || id.includes('\\') || id.includes('..')) {
    throw new Error(`invalid task id: ${id}`);
  }
  return path.join(tasksDir(), `${id}.json`);
}

export function writeTask(task: PersistedTask): void {
  ensureDir();
  try {
    const trimmed: PersistedTask = {
      ...task,
      recentEvents: task.recentEvents.slice(-RECENT_EVENT_CAP),
    };
    fs.writeFileSync(fileFor(task.id), JSON.stringify(trimmed, null, 2), 'utf-8');
  } catch (err) {
    warnNonFatal('coding-agents.state.write', err);
  }
}

export function readTask(id: string): PersistedTask | null {
  try {
    const raw = fs.readFileSync(fileFor(id), 'utf-8');
    return JSON.parse(raw) as PersistedTask;
  } catch {
    return null;
  }
}

export function listTasks(): PersistedTask[] {
  try {
    const dir = tasksDir();
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const out: PersistedTask[] = [];
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, f), 'utf-8');
        out.push(JSON.parse(raw) as PersistedTask);
      } catch {
        // skip corrupt
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function appendEvent(id: string, event: TaskEvent, status?: TaskStatus): void {
  const t = readTask(id);
  if (!t) return;
  t.recentEvents.push(event);
  if (status) t.status = status;
  if (status === 'succeeded' || status === 'failed' || status === 'cancelled') {
    t.endedAt = new Date().toISOString();
  }
  writeTask(t);
}
