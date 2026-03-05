/**
 * Delegate Tool for CodeBot
 *
 * Allows the parent agent to spawn child agents for parallel work.
 * Supports both legacy (simple parallel) and swarm (multi-LLM collaboration) modes.
 */

import { Tool } from '../types';
import { Orchestrator, AgentTask, AgentResult, generateTaskId } from '../orchestrator';
import { SwarmOrchestrator, SwarmStrategyType, SwarmTaskContext, AgentContribution } from '../swarm';

export class DelegateTool implements Tool {
  name = 'delegate';
  description = 'Spawn child agent(s) to handle subtasks. Supports two modes: "legacy" (simple parallel delegation) and "swarm" (multi-LLM collaboration with strategies like debate, mixture-of-agents, pipeline, fan-out, or generator-critic).';
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

  /** Set the legacy orchestrator instance (injected by Agent) */
  setOrchestrator(orchestrator: Orchestrator): void {
    this.orchestrator = orchestrator;
  }

  /** Set the swarm orchestrator instance (injected by Agent) */
  setSwarmOrchestrator(swarm: SwarmOrchestrator): void {
    this.swarmOrchestrator = swarm;
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const mode = (args.mode as string) || 'legacy';

    // ── Swarm Mode ──
    if (mode === 'swarm') {
      if (!this.swarmOrchestrator) {
        return 'Error: Swarm orchestration is not enabled. Configure providers in swarm config.';
      }

      const task = args.task as string;
      if (!task) {
        return 'Error: Provide a "task" string for swarm mode.';
      }

      const strategy = (args.strategy as SwarmStrategyType) || 'auto';
      const files = args.files as string[] | undefined;

      const contributions: AgentContribution[] = [];
      const events: string[] = [];

      try {
        for await (const event of this.swarmOrchestrator.execute(task, {
          files,
          preferredStrategy: strategy,
        })) {
          if (event.type === 'agent_complete' && event.data) {
            const data = event.data as AgentContribution;
            contributions.push(data);
          }
          if (event.type === 'strategy_selected') {
            events.push('Strategy: ' + (event.strategy || 'auto'));
          }
          if (event.type === 'swarm_complete') {
            events.push('Swarm complete');
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return 'Swarm error: ' + msg;
      }

      return this.formatSwarmResults(contributions, events);
    }

    // ── Legacy Mode ──
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
        return 'Error: Cannot spawn child agent -- ' + (check.reason || 'unknown');
      }

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

  private createChildExecutor(): (task: AgentTask) => Promise<{ output: string; toolCalls: string[]; filesModified: string[] }> {
    return async (task: AgentTask) => {
      return {
        output: 'Child agent completed: ' + task.description,
        toolCalls: [],
        filesModified: [],
      };
    };
  }

  private formatResult(result: AgentResult): string {
    const statusIcon = result.status === 'success' ? '[OK]' : result.status === 'timeout' ? '[TIMEOUT]' : '[ERROR]';
    let output = statusIcon + ' Child agent: ' + result.description + '\n';
    output += 'Status: ' + result.status + ' (' + result.durationMs + 'ms)\n';

    if (result.toolCalls.length > 0) {
      output += 'Tools: ' + result.toolCalls.join(', ') + '\n';
    }
    if (result.filesModified.length > 0) {
      output += 'Files modified: ' + result.filesModified.join(', ') + '\n';
    }
    if (result.output) {
      output += 'Output: ' + result.output + '\n';
    }
    if (result.error) {
      output += 'Error: ' + result.error + '\n';
    }

    return output;
  }

  private formatSwarmResults(contributions: AgentContribution[], events: string[]): string {
    const lines: string[] = [];
    lines.push('## Swarm Results (' + contributions.length + ' agents)\n');

    if (events.length > 0) {
      lines.push(events.join(' | ') + '\n');
    }

    for (const c of contributions) {
      lines.push('### [' + c.role.toUpperCase() + '] ' + c.model);
      lines.push('Round: ' + c.round + ' | Duration: ' + c.durationMs + 'ms');

      if (c.toolCalls.length > 0) {
        lines.push('Tools: ' + c.toolCalls.join(', '));
      }
      if (c.filesModified.length > 0) {
        lines.push('Files: ' + c.filesModified.join(', '));
      }
      if (c.content) {
        const truncated = c.content.length > 500 ? c.content.slice(0, 500) + '...' : c.content;
        lines.push('Output: ' + truncated);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
