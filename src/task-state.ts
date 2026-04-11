import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { codebotPath } from './paths';

export type PersistentTaskStatus = 'active' | 'pending' | 'completed' | 'failed';

export interface PersistentTask {
  id: string;
  goal: string;
  normalizedGoal: string;
  status: PersistentTaskStatus;
  createdAt: string;
  updatedAt: string;
  lastUserMessage: string;
  outcomeSummary: string;
  progressNotes: string[];
  failureNotes: string[];
  recentTools: string[];
  touchedPaths: string[];
}

export interface TaskStateSnapshot {
  activeTask: PersistentTask | null;
  pendingTasks: PersistentTask[];
  recentTasks: PersistentTask[];
  updatedAt: string;
}

const MAX_PENDING_TASKS = 6;
const MAX_RECENT_TASKS = 8;
const MAX_TASK_NOTES = 5;
const MAX_RECENT_TOOLS = 8;
const MAX_TOUCHED_PATHS = 8;

function truncate(text: string, maxLength: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function defaultSnapshot(): TaskStateSnapshot {
  return {
    activeTask: null,
    pendingTasks: [],
    recentTasks: [],
    updatedAt: new Date(0).toISOString(),
  };
}

function normalizeGoal(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMeaningfulTask(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 8) return false;
  if (/^(hi|hello|thanks|thank you|ok|okay|cool|great|nice|yep|nope|sure|damn)$/i.test(trimmed)) {
    return false;
  }
  return /[a-z]/i.test(trimmed);
}

function isContinuationMessage(text: string): boolean {
  return /\b(continue|resume|pick up|keep going|same task|that task|finish it|finish this|carry on|status|progress|update|where are we)\b/i.test(
    text,
  );
}

function firstMeaningfulLine(text: string): string {
  const line =
    text
      .split('\n')
      .map((part) => part.trim())
      .find(Boolean) || '';
  return truncate(line.replace(/\s+/g, ' '), 160);
}

function extractTouchedPath(args?: Record<string, unknown>): string | null {
  if (!args) return null;
  const candidates = [args.path, args.file, args.cwd];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return truncate(candidate.trim(), 160);
    }
  }
  return null;
}

function scoreTaskAgainstQuery(task: PersistentTask, query: string): number {
  if (!query.trim()) return 1;
  const normalizedQuery = normalizeGoal(query);
  if (!normalizedQuery) return 1;

  let score = task.status === 'active' ? 4 : 1;
  if (task.normalizedGoal === normalizedQuery) score += 8;
  if (task.normalizedGoal.includes(normalizedQuery) || normalizedQuery.includes(task.normalizedGoal)) score += 4;

  const terms = normalizedQuery.split(' ').filter((term) => term.length > 2);
  for (const term of terms) {
    if (task.normalizedGoal.includes(term)) score += 2;
    if (task.lastUserMessage.toLowerCase().includes(term)) score += 1;
    if (task.outcomeSummary.toLowerCase().includes(term)) score += 1;
  }
  return score;
}

export class TaskStateStore {
  private readonly filePath: string;
  private state: TaskStateSnapshot;

  constructor(projectRoot?: string) {
    this.filePath = projectRoot
      ? path.join(projectRoot, '.codebot', 'task-state.json')
      : codebotPath('task-state.json');
    this.state = this.load();
  }

  beginTurn(message: string): boolean {
    const trimmed = message.trim();
    if (!trimmed) return false;

    const now = new Date().toISOString();
    const active = this.state.activeTask;
    const meaningful = isMeaningfulTask(trimmed);
    const continuation = isContinuationMessage(trimmed);

    if (active) {
      active.lastUserMessage = truncate(trimmed, 240);
      active.updatedAt = now;
    }

    if (!active) {
      if (continuation && this.state.pendingTasks.length > 0) {
        const [nextTask, ...remaining] = this.state.pendingTasks;
        this.state.pendingTasks = remaining;
        this.state.activeTask = {
          ...nextTask,
          status: 'active',
          updatedAt: now,
          lastUserMessage: truncate(trimmed, 240),
        };
        this.touch(now);
        return true;
      }
      if (meaningful) {
        this.state.activeTask = this.createTask(trimmed, 'active', now);
        this.touch(now);
        return true;
      }
      this.touch(now);
      return false;
    }

    if (continuation || normalizeGoal(trimmed) === active.normalizedGoal) {
      this.touch(now);
      return true;
    }

    if (!meaningful) {
      this.touch(now);
      return false;
    }

    this.pushPending({
      ...active,
      status: 'pending',
      outcomeSummary: active.outcomeSummary || 'Paused before completion.',
      updatedAt: now,
    });
    this.state.activeTask = this.createTask(trimmed, 'active', now);
    this.touch(now);
    return true;
  }

  recordToolResult(toolName: string, success: boolean, result: string, args?: Record<string, unknown>): void {
    const active = this.state.activeTask;
    if (!active) return;

    const now = new Date().toISOString();
    active.updatedAt = now;

    const recentTools = active.recentTools.filter((tool) => tool !== toolName);
    recentTools.push(toolName);
    active.recentTools = recentTools.slice(-MAX_RECENT_TOOLS);

    const summary = this.summarizeToolResult(toolName, success, result);
    if (summary) {
      const target = success ? active.progressNotes : active.failureNotes;
      if (target[target.length - 1] !== summary) target.push(summary);
      while (target.length > MAX_TASK_NOTES) target.shift();
      active.outcomeSummary = summary;
    }

    const touchedPath = extractTouchedPath(args);
    if (touchedPath) {
      const touched = active.touchedPaths.filter((existing) => existing !== touchedPath);
      touched.push(touchedPath);
      active.touchedPaths = touched.slice(-MAX_TOUCHED_PATHS);
    }

    this.touch(now);
  }

  completeActiveTask(summary: string, success: boolean): void {
    const active = this.state.activeTask;
    if (!active) return;

    const now = new Date().toISOString();
    const outcomeSummary = truncate(
      summary || (success ? 'Completed successfully.' : 'Stopped before completion.'),
      220,
    );
    const finishedTask: PersistentTask = {
      ...active,
      status: success ? 'completed' : 'failed',
      outcomeSummary,
      updatedAt: now,
    };

    if (success) {
      this.state.recentTasks = [
        finishedTask,
        ...this.state.recentTasks.filter((task) => task.id !== finishedTask.id),
      ].slice(0, MAX_RECENT_TASKS);
    } else {
      this.pushPending({
        ...finishedTask,
        status: 'pending',
      });
      this.state.recentTasks = [
        finishedTask,
        ...this.state.recentTasks.filter((task) => task.id !== finishedTask.id),
      ].slice(0, MAX_RECENT_TASKS);
    }

    this.state.activeTask = null;
    this.touch(now);
  }

  getActiveGoal(): string {
    return this.state.activeTask?.goal || '';
  }

  getRecentTools(): string[] {
    return this.state.activeTask?.recentTools ? [...this.state.activeTask.recentTools] : [];
  }

  getOutcomeHints(): string[] {
    const hints: string[] = [];
    const active = this.state.activeTask;
    if (active?.progressNotes.length) hints.push(active.progressNotes[active.progressNotes.length - 1]);
    if (active?.failureNotes.length) hints.push(active.failureNotes[active.failureNotes.length - 1]);
    for (const task of this.state.recentTasks.slice(0, 2)) {
      if (task.outcomeSummary) hints.push(task.outcomeSummary);
    }
    return hints.slice(0, 4);
  }

  getSnapshot(): TaskStateSnapshot {
    return JSON.parse(JSON.stringify(this.state)) as TaskStateSnapshot;
  }

  buildPromptBlock(query = ''): string {
    const lines: string[] = [];

    if (this.state.activeTask) {
      const active = this.state.activeTask;
      lines.push('## Durable Task State');
      lines.push(`Active task: ${active.goal}`);
      if (active.progressNotes.length > 0) {
        lines.push('Recent progress:');
        for (const note of active.progressNotes.slice(-3)) lines.push(`- ${note}`);
      }
      if (active.failureNotes.length > 0) {
        lines.push('Recent blockers:');
        for (const note of active.failureNotes.slice(-2)) lines.push(`- ${note}`);
      }
      if (active.recentTools.length > 0) {
        lines.push(`Recent tools: ${active.recentTools.join(', ')}`);
      }
      if (active.touchedPaths.length > 0) {
        lines.push(`Touched paths: ${active.touchedPaths.join(', ')}`);
      }
    }

    const pending = [...this.state.pendingTasks]
      .sort((a, b) => scoreTaskAgainstQuery(b, query) - scoreTaskAgainstQuery(a, query))
      .slice(0, 3);
    if (pending.length > 0) {
      if (lines.length === 0) lines.push('## Durable Task State');
      lines.push('Unfinished tasks to keep in mind:');
      for (const task of pending) {
        const summary = task.outcomeSummary ? ` — ${task.outcomeSummary}` : '';
        lines.push(`- ${task.goal}${summary}`);
      }
    }

    const recent = this.state.recentTasks.slice(0, 3);
    if (recent.length > 0) {
      if (lines.length === 0) lines.push('## Durable Task State');
      lines.push('Recently completed or attempted:');
      for (const task of recent) {
        const outcome = task.outcomeSummary ? ` — ${task.outcomeSummary}` : '';
        lines.push(`- [${task.status}] ${task.goal}${outcome}`);
      }
    }

    return lines.length > 0 ? `\n\n--- Durable Task State ---\n${lines.join('\n')}` : '';
  }

  private createTask(goal: string, status: PersistentTaskStatus, now: string): PersistentTask {
    const trimmedGoal = truncate(goal, 240);
    return {
      id: crypto.randomUUID(),
      goal: trimmedGoal,
      normalizedGoal: normalizeGoal(trimmedGoal),
      status,
      createdAt: now,
      updatedAt: now,
      lastUserMessage: trimmedGoal,
      outcomeSummary: '',
      progressNotes: [],
      failureNotes: [],
      recentTools: [],
      touchedPaths: [],
    };
  }

  private summarizeToolResult(toolName: string, success: boolean, result: string): string {
    const normalized = result
      .replace(/\x1b\[[0-9;]*m/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) return success ? `${toolName} completed.` : `${toolName} failed.`;

    const firstLine = firstMeaningfulLine(normalized.replace(/^Error:\s*/i, ''));
    if (success) return `${toolName} succeeded: ${firstLine}`;
    return `${toolName} failed: ${firstLine}`;
  }

  private pushPending(task: PersistentTask): void {
    this.state.pendingTasks = [task, ...this.state.pendingTasks.filter((existing) => existing.id !== task.id)].slice(
      0,
      MAX_PENDING_TASKS,
    );
  }

  private touch(timestamp: string): void {
    this.state.updatedAt = timestamp;
    this.save();
  }

  private load(): TaskStateSnapshot {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<TaskStateSnapshot>;
        return {
          ...defaultSnapshot(),
          ...parsed,
          activeTask: parsed.activeTask ? ({ ...parsed.activeTask } as PersistentTask) : null,
          pendingTasks: Array.isArray(parsed.pendingTasks)
            ? parsed.pendingTasks.map((task) => ({ ...task }) as PersistentTask)
            : [],
          recentTasks: Array.isArray(parsed.recentTasks)
            ? parsed.recentTasks.map((task) => ({ ...task }) as PersistentTask)
            : [],
        };
      }
    } catch {
      return defaultSnapshot();
    }
    return defaultSnapshot();
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2) + '\n');
  }
}
