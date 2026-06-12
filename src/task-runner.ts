/**
 * Task runner — headless autonomous task execution with structured audit output.
 * Used by the --task CLI flag for CI/automation workflows.
 */

import { Agent } from './agent';
import { LLMProvider, AgentEvent } from './types';
import * as fs from 'fs';
import * as path from 'path';
import { VERSION } from './version';

export interface TaskOptions {
  task: string;
  provider: LLMProvider;
  model: string;
  providerName: string;
  projectRoot: string;
  auditLogPath?: string;
  outputFormat?: 'json' | 'text' | 'sarif';
  maxCost?: number;
  preset?: string;
}

export interface TaskResult {
  task: string;
  status: 'completed' | 'failed' | 'cost_exceeded' | 'max_iterations';
  startedAt: string;
  completedAt: string;
  toolCalls: Array<{ tool: string; success: boolean }>;
  filesModified: string[];
  summary: string;
  cost: { input_tokens: number; output_tokens: number; estimated_usd: number };
  errors: string[];
}

// ── Agent setup ───────────────────────────────────────────────────────────────

function createTaskAgent(opts: TaskOptions): Agent {
  const agent = new Agent({
    provider: opts.provider,
    model: opts.model,
    providerName: opts.providerName,
    maxIterations: 50,
    autoApprove: true,
    projectRoot: opts.projectRoot,
  });

  if (opts.preset) {
    try {
      const pe = agent.getPolicyEnforcer();
      if (pe && pe.applyPreset) pe.applyPreset(opts.preset);
    } catch {
      /* preset unavailable */
    }
  }

  if (opts.maxCost) {
    try {
      const tt = agent.getTokenTracker();
      if (tt && tt.setCostLimit) tt.setCostLimit(opts.maxCost);
    } catch {
      /* token tracker unavailable */
    }
  }

  return agent;
}

// ── Event processing ──────────────────────────────────────────────────────────

interface RunState {
  toolCalls: Array<{ tool: string; success: boolean }>;
  filesModified: string[];
  errors: string[];
  lastAssistantText: string;
  status: TaskResult['status'];
}

function processEvent(ev: AgentEvent & { toolResult?: any; text?: string; error?: string }, state: RunState): void {
  switch (ev.type) {
    case 'text':
      state.lastAssistantText = ev.text || '';
      break;
    case 'tool_result':
      if (ev.toolResult) {
        const tc = { tool: ev.toolResult.name || 'unknown', success: !ev.toolResult.is_error };
        state.toolCalls.push(tc);
        process.stderr.write(`  [${tc.success ? '✓' : '✗'}] ${tc.tool}\n`);
        if (['write_file', 'edit_file', 'batch_edit'].includes(tc.tool) && tc.success) {
          state.filesModified.push(tc.tool);
        }
      }
      break;
    case 'error':
      state.errors.push(ev.error || 'Unknown error');
      if (ev.error?.includes('Cost limit')) state.status = 'cost_exceeded';
      else if (ev.error?.includes('Max iterations')) state.status = 'max_iterations';
      else state.status = 'failed';
      break;
    case 'done':
      state.status = 'completed';
      break;
  }
}

// ── Result output ─────────────────────────────────────────────────────────────

function writeOutput(content: string, auditLogPath: string | undefined, label: string): void {
  if (auditLogPath) {
    fs.mkdirSync(path.dirname(path.resolve(auditLogPath)), { recursive: true });
    fs.writeFileSync(auditLogPath, content + '\n');
    if (label) process.stderr.write(`\n  ${label}: ${auditLogPath}\n`);
  } else {
    process.stdout.write(content + '\n');
  }
}

function emitResult(result: TaskResult, opts: TaskOptions): void {
  const format = opts.outputFormat || 'text';

  if (format === 'json') {
    writeOutput(JSON.stringify(result, null, 2), opts.auditLogPath, 'Audit log written to');
    return;
  }

  if (format === 'sarif') {
    writeOutput(JSON.stringify(toSarif(result), null, 2), opts.auditLogPath, '');
    return;
  }

  // Text summary to stderr
  const dur = ((new Date(result.completedAt).getTime() - new Date(result.startedAt).getTime()) / 1000).toFixed(1);
  process.stderr.write(`\n  ── Task Result ──\n`);
  process.stderr.write(`  Status: ${result.status}\n`);
  process.stderr.write(
    `  Tools: ${result.toolCalls.length} calls (${result.toolCalls.filter((t) => t.success).length} succeeded)\n`,
  );
  process.stderr.write(`  Cost: $${result.cost.estimated_usd.toFixed(4)}\n`);
  if (result.errors.length > 0) process.stderr.write(`  Errors: ${result.errors.join('; ')}\n`);
  process.stderr.write(`  Duration: ${dur}s\n\n`);
}

// ── Main entry ────────────────────────────────────────────────────────────────

export async function runTask(opts: TaskOptions): Promise<TaskResult> {
  const startedAt = new Date().toISOString();
  const state: RunState = {
    toolCalls: [],
    filesModified: [],
    errors: [],
    lastAssistantText: '',
    status: 'completed',
  };

  const agent = createTaskAgent(opts);
  process.stderr.write(`\n  CodeBot Task Runner\n  Task: ${opts.task}\n  Model: ${opts.model}\n\n`);

  try {
    for await (const event of agent.run(opts.task)) {
      processEvent(event as AgentEvent & { toolResult?: any; text?: string; error?: string }, state);
    }
  } catch (err: unknown) {
    state.errors.push(err instanceof Error ? err.message : String(err));
    state.status = 'failed';
  }

  const completedAt = new Date().toISOString();
  const summary =
    state.lastAssistantText ||
    (state.status === 'completed' ? 'Task completed successfully.' : `Task ${state.status}.`);

  const result: TaskResult = {
    task: opts.task,
    status: state.status,
    startedAt,
    completedAt,
    toolCalls: state.toolCalls,
    filesModified: [...new Set(state.filesModified)],
    summary: summary.substring(0, 2000),
    cost: { input_tokens: 0, output_tokens: 0, estimated_usd: 0 },
    errors: state.errors,
  };

  try {
    const tt = agent.getTokenTracker();
    if (tt) {
      const s = tt.getSummary();
      result.cost = {
        input_tokens: s.totalInputTokens || 0,
        output_tokens: s.totalOutputTokens || 0,
        estimated_usd: tt.getTotalCost() || 0,
      };
    }
  } catch {
    /* token tracker unavailable */
  }

  emitResult(result, opts);
  return result;
}

function toSarif(result: TaskResult): object {
  return {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: { name: 'CodeBot', version: VERSION, informationUri: 'https://github.com/Ascendral/codebot-ai' },
        },
        results: result.errors.map((err, i) => ({
          ruleId: 'task-error',
          level: 'error',
          message: { text: err },
          ruleIndex: i,
        })),
        invocations: [
          {
            executionSuccessful: result.status === 'completed',
            startTimeUtc: result.startedAt,
            endTimeUtc: result.completedAt,
          },
        ],
      },
    ],
  };
}
