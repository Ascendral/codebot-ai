/**
 * Delegate Tool for CodeBot v2.2.0-alpha
 *
 * Allows the parent agent to spawn child agents for parallel work.
 * Each child gets a scoped task, inherits policy, and reports back.
 *
 * Usage:
 *   delegate({ task: "Refactor auth module", files: ["src/auth.ts"] })
 *   delegate({ tasks: [{ task: "Fix file1", files: [...] }, { task: "Fix file2", files: [...] }] })
 *
 * Swarm mode (v2.3+):
 *   delegate({ task: "Design API", files: [...], mode: "swarm", strategy: "debate" })
 */

import { Tool } from '../types';
import { Orchestrator, AgentTask, AgentResult, generateTaskId } from '../orchestrator';
import { SwarmOrchestrator, SwarmStrategyType, SwarmEvent, AgentContribution } from '../swarm';

export class DelegateTool implements Tool {
  name = 'delegate';
  description = 'Spawn child agent(s) to handle subtasks in parallel. Use for multi-file operations, parallel refactoring, or independent tasks. Each child gets a scoped task description and optional file context. Results are collected and returned. Supports swarm mode for multi-LLM collaboration.';
  permission: Tool['permission'] = 'prompt';
  parameters = {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'Single task description for a child agent (use for one task)',
      },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files/directories the child should focus on (scoped context)',
      },
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'Task description' },
            files: { type: 'array', items: { type: 'string' }, description: 'Scoped files' },
          },
          required: ['task'],
        },
        description: 'Multiple tasks to run in parallel (use for batch delegation)',
      },
      mode: {
        type: 'string',
        description: 'Orchestration mode: "legacy" (simple parallel) or "swarm" (multi-LLM collaboration). Default: legacy.',
      },
      strategy: {
        type: 'string',
        description: 'Swarm strategy: debate, moa, pipeline, fan-out, generator-critic, auto. Only used in swarm mode. Default: auto.',
      },
    },
  };

  private orchestrator: Orchestrator | null = null;
  private swarmOrchestrator: SwarmOrchestrator | null = null;

  /** Set the orchestrator instance (injected by Agent) */
  setOrchestrator(orchestrator: Orchestrator) {
    this.orchestrator = orchestrator;
  }

  /** Set the swarm orchestrator instance (injected by Agent for swarm mode) */
  setSwarmOrchestrator(swarmOrchestrator: SwarmOrchestrator) {
    this.swarmOrchestrator = swarmOrchestrator;
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    // ── Swarm mode ──
    if (args.mode === 'swarm' && this.swarmOrchestrator) {
      const taskDescription = (args.task as string) || 'Swarm task';
      const files = (args.files as string[]) || [];
      const strategy = (args.strategy as SwarmStrategyType) || 'auto';

      const taskContext = {
        id: generateTaskId(),
        description: taskDescription,
        files,
        strategy,
      };

      const contributions: AgentContribution[] = [];

      for await (const event of this.swarmOrchestrator.execute(taskContext)) {
        if (event.type === 'contribution') {
          contributions.push(event.data as AgentContribution);
        }
      }

      return this.formatSwarmResults(contributions);
    }

    // ── Legacy mode (existing behavior) ──
    if (!this.orchestrator) {
      return 'Error: Multi-agent orchestration is not enabled. Start with --router or configure orchestration in policy.';
    }

    // Single task mode
    if (args.task && typeof args.task === 'string') {
      const task: AgentTask = {
        id: generateTaskId(),
        description: args.task,
        context: args.files as string[] | undefined,
      };

      const check = this.orchestrator.canSpawn();
      if (!check.allowed) {
        return `Error: Cannot spawn child agent — ${check.reason}`;
      }

      // Execute with a stub executor (real implementation wired in Agent)
      const result = await this.orchestrator.delegate(task, this.createChildExecutor());
      return this.formatResult(result);
    }

    // Batch mode
    if (args.tasks && Array.isArray(args.tasks)) {
      const tasks: AgentTask[] = (args.tasks as Array<Record<string, unknown>>).map(t => ({
        id: generateTaskId(),
        description: t.task as string,
        context: t.files as string[] | undefined,
      }));

      if (tasks.length === 0) {
        return 'Error: No tasks provided.';
      }

      const results = await this.orchestrator.delegateAll(tasks, this.createChildExecutor());
      return this.orchestrator.formatResultsSummary(results);
    }

    return 'Error: Provide either "task" (string) for a single child agent, or "tasks" (array) for parallel delegation.';
  }

  /**
   * Create a child executor function.
   * In the real implementation, this creates a new Agent instance
   * with inherited policy and scoped context.
   *
   * For now, this returns a stub that simulates child execution.
   * The Agent class will override this with real execution.
   */
  private createChildExecutor(): (task: AgentTask) => Promise<{ output: string; toolCalls: string[]; filesModified: string[] }> {
    return async (task: AgentTask) => {
      // Stub: the real executor is injected by the Agent class
      return {
        output: `Child agent completed: ${task.description}`,
        toolCalls: [],
        filesModified: [],
      };
    };
  }

  private formatResult(result: AgentResult): string {
    const statusIcon = result.status === 'success' ? '✅' : result.status === 'timeout' ? '⏱' : '❌';
    let output = `${statusIcon} Child agent: ${result.description}\n`;
    output += `Status: ${result.status} (${result.durationMs}ms)\n`;

    if (result.toolCalls.length > 0) {
      output += `Tools: ${result.toolCalls.join(', ')}\n`;
    }
    if (result.filesModified.length > 0) {
      output += `Files modified: ${result.filesModified.join(', ')}\n`;
    }
    if (result.output) {
      output += `Output: ${result.output}\n`;
    }
    if (result.error) {
      output += `Error: ${result.error}\n`;
    }

    return output;
  }

  private formatSwarmResults(contributions: AgentContribution[]): string {
    if (contributions.length === 0) return 'No swarm contributions received.';

    const lines = [`## Swarm Results (${contributions.length} contributions)\n`];

    for (const c of contributions) {
      const role = c.role || 'agent';
      const model = c.model || 'unknown';
      const round = c.round != null ? c.round : '?';
      lines.push(`### [${role}] (model: ${model}, round: ${round})`);

      if (c.filesModified && c.filesModified.length > 0) {
        lines.push(`- Files modified: ${c.filesModified.join(', ')}`);
      }
      if (c.output) {
        const truncated = c.output.length > 500 ? c.output.substring(0, 500) + '...' : c.output;
        lines.push(`- Output: ${truncated}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
