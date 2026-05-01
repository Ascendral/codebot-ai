/**
 * EchoCodingAgentProvider — PR 27 stub.
 *
 * Emits three deterministic events (status=running, log, result) and
 * transitions to status=succeeded. Burns no external credits, makes no
 * network calls. Its only job is to prove the boundary wires end-to-end:
 * registry submits → provider streams → state persists → audit chain
 * records. PR 28 replaces this with a real CursorAgentProvider on the
 * same contract.
 */

import { AuditLogger } from '../audit';
import { appendEvent } from './state';
import type { CapabilityLabel } from '../types';
import type {
  CodingAgentProvider,
  TaskSpec,
  TaskHandle,
  TaskEvent,
  TaskStatus,
} from './types';

class EchoTaskHandle implements TaskHandle {
  readonly id: string;
  readonly spec: Readonly<TaskSpec>;
  private currentStatus: TaskStatus = 'queued';
  private buffer: TaskEvent[] = [];
  private resolveNext: ((e: IteratorResult<TaskEvent>) => void) | null = null;
  private done = false;
  private audit: AuditLogger | null;

  constructor(spec: TaskSpec, audit: AuditLogger | null) {
    this.id = spec.id!;
    this.spec = Object.freeze({ ...spec });
    this.audit = audit;

    // Drive the fake stream on next tick so callers can attach events()
    // before the first emission.
    setImmediate(() => this.run());
  }

  private now(): string {
    return new Date().toISOString();
  }

  private emit(event: TaskEvent, statusUpdate?: TaskStatus): void {
    if (statusUpdate) this.currentStatus = statusUpdate;
    appendEvent(this.id, event, statusUpdate);
    this.audit?.log({
      tool: `coding-agent:echo`,
      action: event.type === 'result' ? 'task_complete' : 'task_event',
      args: { id: this.id, event },
    });
    if (this.resolveNext) {
      const r = this.resolveNext;
      this.resolveNext = null;
      r({ value: event, done: false });
    } else {
      this.buffer.push(event);
    }
  }

  private finish(): void {
    this.done = true;
    if (this.resolveNext) {
      const r = this.resolveNext;
      this.resolveNext = null;
      r({ value: undefined as unknown as TaskEvent, done: true });
    }
  }

  private run(): void {
    if (this.done) return; // cancelled before run started
    this.emit({ type: 'status', status: 'running', at: this.now() }, 'running');
    this.emit({
      type: 'log',
      level: 'info',
      message: `echo provider received: "${this.spec.title}"`,
      at: this.now(),
    });
    this.emit(
      {
        type: 'result',
        ok: true,
        summary: `echo: ${this.spec.prompt.slice(0, 80)}`,
        at: this.now(),
      },
      'succeeded',
    );
    this.finish();
  }

  status(): TaskStatus {
    return this.currentStatus;
  }

  events(): AsyncIterable<TaskEvent> {
    const self = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<TaskEvent> {
        return {
          next(): Promise<IteratorResult<TaskEvent>> {
            if (self.buffer.length > 0) {
              const event = self.buffer.shift()!;
              return Promise.resolve({ value: event, done: false });
            }
            if (self.done) {
              return Promise.resolve({ value: undefined as unknown as TaskEvent, done: true });
            }
            return new Promise<IteratorResult<TaskEvent>>(res => {
              self.resolveNext = res;
            });
          },
        };
      },
    };
  }

  async cancel(reason: string): Promise<void> {
    if (
      this.currentStatus === 'succeeded' ||
      this.currentStatus === 'failed' ||
      this.currentStatus === 'cancelled'
    ) {
      return;
    }
    this.emit(
      { type: 'log', level: 'warn', message: `cancelled: ${reason}`, at: this.now() },
      'cancelled',
    );
    this.audit?.log({
      tool: 'coding-agent:echo',
      action: 'task_cancelled',
      args: { id: this.id, reason },
    });
    this.finish();
  }

  async respondToApproval(): Promise<void> {
    throw new Error('echo provider does not request approvals');
  }
}

export class EchoCodingAgentProvider implements CodingAgentProvider {
  readonly name = 'echo';
  readonly displayName = 'Echo (test stub)';
  readonly capabilities: CapabilityLabel[] = ['read-only'];
  readonly vaultKeyName = undefined;

  private audit: AuditLogger | null;

  constructor(audit?: AuditLogger) {
    this.audit = audit ?? null;
  }

  validateSpec(spec: TaskSpec): string | null {
    if (!spec.title || spec.title.trim().length === 0) return 'title is required';
    if (!spec.prompt || spec.prompt.trim().length === 0) return 'prompt is required';
    if (!spec.cwd || spec.cwd.trim().length === 0) return 'cwd is required';
    return null;
  }

  async start(spec: TaskSpec, _credential: string | null): Promise<TaskHandle> {
    return new EchoTaskHandle(spec, this.audit);
  }
}
