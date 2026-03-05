import { ContextBus, BusMessage } from './context-bus';
import { AgentRole } from './roles';

// ---------------------------------------------------------------------------
// Forward-declared types (mirrors index.ts — defined here to avoid circular imports)
// ---------------------------------------------------------------------------

export interface SwarmAgent {
  id: string;
  role: AgentRole;
  model: string;
  providerName: string;
  status: 'idle' | 'running' | 'complete' | 'error';
  depth: number;
  /** Execute this agent with a prompt, returns output string */
  run(prompt: string): Promise<AgentRunResult>;
}

export interface AgentRunResult {
  output: string;
  toolCalls: string[];
  filesModified: string[];
  durationMs: number;
  tokenUsage: { input: number; output: number };
  errors: number;
}

export interface AgentContribution {
  agentId: string;
  role: AgentRole;
  model: string;
  round: number;
  content: string;
  toolCalls: string[];
  filesModified: string[];
  durationMs: number;
  tokenUsage: { input: number; output: number };
}

export interface SwarmEvent {
  type:
    | 'swarm_start'
    | 'agent_spawn'
    | 'agent_complete'
    | 'agent_error'
    | 'strategy_selected'
    | 'round_start'
    | 'round_end'
    | 'synthesis'
    | 'context_update'
    | 'vote'
    | 'swarm_complete'
    | 'swarm_error';
  swarmId: string;
  agentId?: string;
  role?: AgentRole;
  model?: string;
  strategy?: string;
  round?: number;
  data?: unknown;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Strategy interface
// ---------------------------------------------------------------------------

export interface SwarmStrategy {
  name: string;
  description: string;
  execute(
    agents: SwarmAgent[],
    task: string,
    bus: ContextBus,
    swarmId: string,
  ): AsyncGenerator<SwarmEvent, AgentContribution[]>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  swarmId: string,
  type: SwarmEvent['type'],
  extras?: Partial<SwarmEvent>,
): SwarmEvent {
  return { type, swarmId, timestamp: Date.now(), ...extras };
}

function runToContribution(
  agent: SwarmAgent,
  result: AgentRunResult,
  round: number,
): AgentContribution {
  return {
    agentId: agent.id,
    role: agent.role,
    model: agent.model,
    round,
    content: result.output,
    toolCalls: result.toolCalls,
    filesModified: result.filesModified,
    durationMs: result.durationMs,
    tokenUsage: result.tokenUsage,
  };
}

// ---------------------------------------------------------------------------
// 1. DebateStrategy
// ---------------------------------------------------------------------------

interface DebateConfig {
  maxRounds: number;
  consensusThreshold: number;
}

export class DebateStrategy implements SwarmStrategy {
  readonly name = 'debate';
  readonly description =
    'Agents debate proposals over multiple rounds, voting until consensus is reached.';

  private maxRounds: number;
  private consensusThreshold: number;

  constructor(config?: Partial<DebateConfig>) {
    this.maxRounds = config?.maxRounds ?? 3;
    this.consensusThreshold = config?.consensusThreshold ?? 0.7;
  }

  async *execute(
    agents: SwarmAgent[],
    task: string,
    bus: ContextBus,
    swarmId: string,
  ): AsyncGenerator<SwarmEvent, AgentContribution[]> {
    const contributions: AgentContribution[] = [];

    // --- Round 1: initial proposals (all agents in parallel) ---
    yield makeEvent(swarmId, 'round_start', { round: 1 });

    for (const agent of agents) {
      yield makeEvent(swarmId, 'agent_spawn', {
        agentId: agent.id,
        role: agent.role,
        model: agent.model,
      });
    }

    const r1Results = await Promise.all(
      agents.map(async (agent) => {
        const result = await agent.run(task);
        bus.post({
          fromAgentId: agent.id,
          fromRole: agent.role,
          type: 'contribution',
          target: '*',
          payload: { summary: 'contribution', content: result.output },
          round: 1,
        });
        return { agent, result };
      }),
    );

    for (const { agent, result } of r1Results) {
      yield makeEvent(swarmId, 'agent_complete', {
        agentId: agent.id,
        role: agent.role,
        model: agent.model,
        round: 1,
        data: { durationMs: result.durationMs },
      });
      contributions.push(runToContribution(agent, result, 1));
    }

    yield makeEvent(swarmId, 'round_end', { round: 1 });

    // --- Rounds 2-N: debate & vote ---
    for (let round = 2; round <= this.maxRounds; round++) {
      yield makeEvent(swarmId, 'round_start', { round });

      const busContext = bus
        .getAllMessages()
        .map((e: BusMessage) => `[${e.fromRole}/${e.fromAgentId}] ${e.payload.content}`)
        .join('\n---\n');

      const debateResults = await Promise.all(
        agents.map(async (agent) => {
          const prompt = [
            `Here are proposals from other agents:`,
            busContext,
            ``,
            `Critique these proposals. Defend your approach or revise it.`,
            `Then vote: approve the best proposal, reject bad ones.`,
          ].join('\n');

          const result = await agent.run(prompt);

          bus.post({
            fromAgentId: agent.id,
            fromRole: agent.role,
            type: 'contribution',
            target: '*',
            payload: { summary: 'contribution', content: result.output },
            round,
          });

          // Post vote entry
          bus.post({
            fromAgentId: agent.id,
            fromRole: agent.role,
            type: 'vote',
            target: '*',
            payload: { summary: 'vote', content: result.output },
            round,
          });

          return { agent, result };
        }),
      );

      for (const { agent, result } of debateResults) {
        yield makeEvent(swarmId, 'agent_complete', {
          agentId: agent.id,
          role: agent.role,
          model: agent.model,
          round,
          data: { durationMs: result.durationMs },
        });
        contributions.push(runToContribution(agent, result, round));
      }

      yield makeEvent(swarmId, 'round_end', { round });

      // Check consensus via votes
      const votes = bus.getByType('vote', round);
      if (votes.length > 0) {
        const approvals = votes.filter((v: BusMessage) =>
          v.payload.content.toLowerCase().includes('approve'),
        ).length;
        const ratio = approvals / agents.length;
        if (ratio >= this.consensusThreshold) {
          yield makeEvent(swarmId, 'vote', {
            round,
            data: { consensus: true, ratio },
          });
          break;
        }
      }
    }

    return contributions;
  }
}

// ---------------------------------------------------------------------------
// 2. MoAStrategy (Mixture of Agents)
// ---------------------------------------------------------------------------

interface MoAConfig {
  layers: number;
}

export class MoAStrategy implements SwarmStrategy {
  readonly name = 'moa';
  readonly description =
    'Mixture-of-Agents: proposer agents generate solutions, then a synthesizer merges them.';

  private layers: number;

  constructor(config?: Partial<MoAConfig>) {
    this.layers = config?.layers ?? 2;
  }

  async *execute(
    agents: SwarmAgent[],
    task: string,
    bus: ContextBus,
    swarmId: string,
  ): AsyncGenerator<SwarmEvent, AgentContribution[]> {
    const contributions: AgentContribution[] = [];

    if (agents.length === 0) {
      return contributions;
    }

    const proposers = agents.slice(0, -1);
    const synthesizer = agents[agents.length - 1];

    // --- Layer 1: Proposers run in parallel ---
    yield makeEvent(swarmId, 'round_start', {
      round: 1,
      data: { layer: 1, phase: 'propose' },
    });

    for (const agent of proposers) {
      yield makeEvent(swarmId, 'agent_spawn', {
        agentId: agent.id,
        role: agent.role,
        model: agent.model,
      });
    }

    const propResults = await Promise.all(
      proposers.map(async (agent) => {
        const result = await agent.run(task);
        bus.post({
          fromAgentId: agent.id,
          fromRole: agent.role,
          type: 'contribution',
          target: '*',
          payload: { summary: 'contribution', content: result.output },
          round: 1,
        });
        return { agent, result };
      }),
    );

    for (const { agent, result } of propResults) {
      yield makeEvent(swarmId, 'agent_complete', {
        agentId: agent.id,
        role: agent.role,
        model: agent.model,
        round: 1,
        data: { durationMs: result.durationMs },
      });
      contributions.push(runToContribution(agent, result, 1));
    }

    yield makeEvent(swarmId, 'round_end', { round: 1 });

    // --- Layer 2: Synthesizer merges all proposals ---
    yield makeEvent(swarmId, 'round_start', {
      round: 2,
      data: { layer: 2, phase: 'synthesize' },
    });

    const busContext = bus
      .getAllMessages()
      .map((e: BusMessage) => `[${e.fromRole}/${e.fromAgentId}] ${e.payload.content}`)
      .join('\n---\n');

    const synthPrompt = [
      `Multiple agents proposed solutions:`,
      busContext,
      ``,
      `Synthesize the best elements from all proposals into a single unified solution.`,
    ].join('\n');

    yield makeEvent(swarmId, 'agent_spawn', {
      agentId: synthesizer.id,
      role: synthesizer.role,
      model: synthesizer.model,
    });

    const synthResult = await synthesizer.run(synthPrompt);

    bus.post({
      fromAgentId: synthesizer.id,
      fromRole: synthesizer.role,
      type: 'contribution',
      target: '*',
      payload: { summary: 'contribution', content: synthResult.output },
      round: 2,
    });

    yield makeEvent(swarmId, 'agent_complete', {
      agentId: synthesizer.id,
      role: synthesizer.role,
      model: synthesizer.model,
      round: 2,
      data: { durationMs: synthResult.durationMs },
    });
    yield makeEvent(swarmId, 'synthesis', {
      agentId: synthesizer.id,
      data: { length: synthResult.output.length },
    });

    contributions.push(runToContribution(synthesizer, synthResult, 2));

    yield makeEvent(swarmId, 'round_end', { round: 2 });

    return contributions;
  }
}

// ---------------------------------------------------------------------------
// 3. PipelineStrategy
// ---------------------------------------------------------------------------

const PIPELINE_ORDER: Record<string, number> = {
  planner: 0,
  researcher: 1,
  architect: 2,
  coder: 3,
  reviewer: 4,
  tester: 5,
};

export class PipelineStrategy implements SwarmStrategy {
  readonly name = 'pipeline';
  readonly description =
    'Agents execute sequentially in role-order, each building on the previous stage.';

  async *execute(
    agents: SwarmAgent[],
    task: string,
    bus: ContextBus,
    swarmId: string,
  ): AsyncGenerator<SwarmEvent, AgentContribution[]> {
    const contributions: AgentContribution[] = [];

    // Sort agents by pipeline order
    const sorted = [...agents].sort((a, b) => {
      const oa = PIPELINE_ORDER[a.role] ?? 6;
      const ob = PIPELINE_ORDER[b.role] ?? 6;
      return oa - ob;
    });

    for (let stage = 0; stage < sorted.length; stage++) {
      const agent = sorted[stage];
      const round = stage + 1;

      yield makeEvent(swarmId, 'round_start', {
        round,
        data: { stage, role: agent.role },
      });
      yield makeEvent(swarmId, 'agent_spawn', {
        agentId: agent.id,
        role: agent.role,
        model: agent.model,
      });

      let prompt: string;
      if (stage === 0) {
        prompt = task;
      } else {
        const busContext = bus
          .getAllMessages()
          .map((e: BusMessage) => `[${e.fromRole}/${e.fromAgentId}] ${e.payload.content}`)
          .join('\n---\n');

        prompt = [
          task,
          ``,
          `Previous stages have completed:`,
          busContext,
          ``,
          `Your role (${agent.role}): complete your stage.`,
        ].join('\n');
      }

      const result = await agent.run(prompt);

      bus.post({
        fromAgentId: agent.id,
        fromRole: agent.role,
        type: 'contribution',
        target: '*',
        payload: { summary: 'contribution', content: result.output },
        round,
      });

      yield makeEvent(swarmId, 'agent_complete', {
        agentId: agent.id,
        role: agent.role,
        model: agent.model,
        round,
        data: { durationMs: result.durationMs },
      });

      contributions.push(runToContribution(agent, result, round));

      yield makeEvent(swarmId, 'round_end', { round });
    }

    return contributions;
  }
}

// ---------------------------------------------------------------------------
// 4. FanOutGatherStrategy
// ---------------------------------------------------------------------------

interface FanOutConfig {
  maxParallel: number;
}

export class FanOutGatherStrategy implements SwarmStrategy {
  readonly name = 'fan-out';
  readonly description =
    'A planner decomposes the task, workers execute subtasks in parallel, then results are gathered.';

  private maxParallel: number;

  constructor(config?: Partial<FanOutConfig>) {
    this.maxParallel = config?.maxParallel ?? 8;
  }

  async *execute(
    agents: SwarmAgent[],
    task: string,
    bus: ContextBus,
    swarmId: string,
  ): AsyncGenerator<SwarmEvent, AgentContribution[]> {
    const contributions: AgentContribution[] = [];

    if (agents.length === 0) {
      return contributions;
    }

    let subtasks: string[] = [];
    let workerAgents = agents;
    let round = 1;

    const firstAgent = agents[0];
    const lastAgent = agents[agents.length - 1];

    // --- Phase 1: Decompose (if first agent is a planner) ---
    if (firstAgent.role === 'planner') {
      yield makeEvent(swarmId, 'round_start', {
        round: 1,
        data: { phase: 'decompose' },
      });
      yield makeEvent(swarmId, 'agent_spawn', {
        agentId: firstAgent.id,
        role: firstAgent.role,
        model: firstAgent.model,
      });

      const decomposePrompt = [
        task,
        ``,
        `Decompose this task into independent subtasks.`,
        `Output JSON array: [{"subtask": "...", "files": [...]}]`,
      ].join('\n');

      const decomposeResult = await firstAgent.run(decomposePrompt);

      bus.post({
        fromAgentId: firstAgent.id,
        fromRole: firstAgent.role,
        type: 'contribution',
        target: '*',
        payload: { summary: 'contribution', content: decomposeResult.output },
        round: 1,
      });

      yield makeEvent(swarmId, 'agent_complete', {
        agentId: firstAgent.id,
        role: firstAgent.role,
        model: firstAgent.model,
        round: 1,
        data: { durationMs: decomposeResult.durationMs },
      });

      contributions.push(runToContribution(firstAgent, decomposeResult, 1));

      // Try to parse subtasks from output
      try {
        const jsonMatch = decomposeResult.output.match(/\[[\s\S]*?\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as Array<{
            subtask: string;
            files?: string[];
          }>;
          subtasks = parsed.map((item) => item.subtask);
        }
      } catch {
        // Parsing failed — fall through to default behaviour
      }

      workerAgents = agents.slice(1);
      round = 2;

      yield makeEvent(swarmId, 'round_end', { round: 1 });
    }

    // If no subtasks could be parsed, each worker gets the original task
    if (subtasks.length === 0) {
      subtasks = workerAgents.map(() => task);
    }

    // --- Phase 2: Fan-Out ---
    const hasSynthesizer =
      lastAgent.role === ('synthesizer' as AgentRole) && workerAgents.length > 1;
    const workers = hasSynthesizer ? workerAgents.slice(0, -1) : workerAgents;

    yield makeEvent(swarmId, 'round_start', {
      round,
      data: { phase: 'fan-out' },
    });

    // Process workers in batches of maxParallel
    for (
      let batchStart = 0;
      batchStart < workers.length;
      batchStart += this.maxParallel
    ) {
      const batch = workers.slice(batchStart, batchStart + this.maxParallel);

      const batchResults = await Promise.all(
        batch.map(async (agent, idx) => {
          const subtaskIdx = batchStart + idx;
          const assignedTask = subtasks[subtaskIdx % subtasks.length];

          const result = await agent.run(assignedTask);

          bus.post({
            fromAgentId: agent.id,
            fromRole: agent.role,
            type: 'contribution',
            target: '*',
            payload: { summary: 'contribution', content: result.output },
            round,
          });

          return { agent, result };
        }),
      );

      for (const { agent, result } of batchResults) {
        yield makeEvent(swarmId, 'agent_complete', {
          agentId: agent.id,
          role: agent.role,
          model: agent.model,
          round,
          data: { durationMs: result.durationMs },
        });
        contributions.push(runToContribution(agent, result, round));
      }
    }

    yield makeEvent(swarmId, 'round_end', { round });

    // --- Phase 3: Gather (synthesize if last agent is synthesizer) ---
    if (hasSynthesizer) {
      round += 1;
      yield makeEvent(swarmId, 'round_start', {
        round,
        data: { phase: 'gather' },
      });
      yield makeEvent(swarmId, 'agent_spawn', {
        agentId: lastAgent.id,
        role: lastAgent.role,
        model: lastAgent.model,
      });

      const busContext = bus
        .getAllMessages()
        .map((e: BusMessage) => `[${e.fromRole}/${e.fromAgentId}] ${e.payload.content}`)
        .join('\n---\n');

      const gatherPrompt = [
        `The following subtask results need to be merged into a final solution:`,
        busContext,
        ``,
        `Merge all results into a cohesive final deliverable.`,
      ].join('\n');

      const gatherResult = await lastAgent.run(gatherPrompt);

      bus.post({
        fromAgentId: lastAgent.id,
        fromRole: lastAgent.role,
        type: 'contribution',
        target: '*',
        payload: { summary: 'contribution', content: gatherResult.output },
        round,
      });

      yield makeEvent(swarmId, 'agent_complete', {
        agentId: lastAgent.id,
        role: lastAgent.role,
        model: lastAgent.model,
        round,
        data: { durationMs: gatherResult.durationMs },
      });
      yield makeEvent(swarmId, 'synthesis', {
        agentId: lastAgent.id,
        data: { length: gatherResult.output.length },
      });

      contributions.push(runToContribution(lastAgent, gatherResult, round));

      yield makeEvent(swarmId, 'round_end', { round });
    }

    return contributions;
  }
}

// ---------------------------------------------------------------------------
// 5. GeneratorCriticStrategy
// ---------------------------------------------------------------------------

interface GeneratorCriticConfig {
  maxIterations: number;
  qualityThreshold: number;
}

export class GeneratorCriticStrategy implements SwarmStrategy {
  readonly name = 'generator-critic';
  readonly description =
    'A generator produces solutions while a critic reviews them iteratively until quality is met.';

  private maxIterations: number;
  private qualityThreshold: number;

  constructor(config?: Partial<GeneratorCriticConfig>) {
    this.maxIterations = config?.maxIterations ?? 3;
    this.qualityThreshold = config?.qualityThreshold ?? 8;
  }

  async *execute(
    agents: SwarmAgent[],
    task: string,
    bus: ContextBus,
    swarmId: string,
  ): AsyncGenerator<SwarmEvent, AgentContribution[]> {
    const contributions: AgentContribution[] = [];

    if (agents.length < 2) {
      // Need at least a generator and a critic
      return contributions;
    }

    const generator = agents[0]; // coder
    const critic = agents[1]; // reviewer

    // --- Iteration 1: Generator produces initial solution ---
    let round = 1;
    yield makeEvent(swarmId, 'round_start', {
      round,
      data: { phase: 'generate' },
    });
    yield makeEvent(swarmId, 'agent_spawn', {
      agentId: generator.id,
      role: generator.role,
      model: generator.model,
    });

    let genResult = await generator.run(task);

    bus.post({
      fromAgentId: generator.id,
      fromRole: generator.role,
      type: 'contribution',
      target: '*',
      payload: { summary: 'contribution', content: genResult.output },
      round,
    });

    yield makeEvent(swarmId, 'agent_complete', {
      agentId: generator.id,
      role: generator.role,
      model: generator.model,
      round,
      data: { durationMs: genResult.durationMs },
    });

    contributions.push(runToContribution(generator, genResult, round));
    yield makeEvent(swarmId, 'round_end', { round });

    // --- Iterations 2-N: Critic reviews, Generator revises ---
    for (let iteration = 2; iteration <= this.maxIterations; iteration++) {
      round = iteration;

      // -- Critic reviews --
      yield makeEvent(swarmId, 'round_start', {
        round,
        data: { phase: 'critique' },
      });
      yield makeEvent(swarmId, 'agent_spawn', {
        agentId: critic.id,
        role: critic.role,
        model: critic.model,
      });

      const generatorOutput = bus
        .getAllMessages()
        .filter((e: BusMessage) => e.fromAgentId === generator.id)
        .map((e: BusMessage) => e.payload.content)
        .join('\n---\n');

      const criticPrompt = [
        `Review the following solution:`,
        generatorOutput,
        ``,
        `Provide specific feedback. Rate the solution: "Rating: N/10" where N is 1-10.`,
        `Identify issues and suggest improvements.`,
      ].join('\n');

      const criticResult = await critic.run(criticPrompt);

      bus.post({
        fromAgentId: critic.id,
        fromRole: critic.role,
        type: 'contribution',
        target: '*',
        payload: { summary: 'contribution', content: criticResult.output },
        round,
      });

      yield makeEvent(swarmId, 'agent_complete', {
        agentId: critic.id,
        role: critic.role,
        model: critic.model,
        round,
        data: { durationMs: criticResult.durationMs },
      });

      contributions.push(runToContribution(critic, criticResult, round));

      // Check quality threshold — look for "Rating: N/10" or "Score: N" pattern
      const ratingMatch = criticResult.output.match(
        /(?:Rating|Score)\s*:\s*(\d+)(?:\s*\/\s*10)?/i,
      );
      if (ratingMatch) {
        const score = parseInt(ratingMatch[1], 10);
        yield makeEvent(swarmId, 'vote', {
          agentId: critic.id,
          round,
          data: { score, threshold: this.qualityThreshold },
        });
        if (score >= this.qualityThreshold) {
          yield makeEvent(swarmId, 'round_end', { round });
          break;
        }
      }

      yield makeEvent(swarmId, 'round_end', { round });

      // -- Generator revises based on feedback (if not last iteration) --
      if (iteration < this.maxIterations) {
        round += 1;

        yield makeEvent(swarmId, 'round_start', {
          round,
          data: { phase: 'revise' },
        });

        const feedback = bus
          .getAllMessages()
          .filter((e: BusMessage) => e.fromAgentId === critic.id)
          .map((e: BusMessage) => e.payload.content)
          .join('\n---\n');

        const revisePrompt = [
          task,
          ``,
          `Your previous solution received this feedback:`,
          feedback,
          ``,
          `Revise your solution to address the feedback.`,
        ].join('\n');

        yield makeEvent(swarmId, 'agent_spawn', {
          agentId: generator.id,
          role: generator.role,
          model: generator.model,
        });

        genResult = await generator.run(revisePrompt);

        bus.post({
          fromAgentId: generator.id,
          fromRole: generator.role,
          type: 'contribution',
          target: '*',
          payload: { summary: 'contribution', content: genResult.output },
          round,
        });

        yield makeEvent(swarmId, 'agent_complete', {
          agentId: generator.id,
          role: generator.role,
          model: generator.model,
          round,
          data: { durationMs: genResult.durationMs },
        });

        contributions.push(runToContribution(generator, genResult, round));

        yield makeEvent(swarmId, 'round_end', { round });
      }
    }

    return contributions;
  }
}

// ---------------------------------------------------------------------------
// Strategy Factory
// ---------------------------------------------------------------------------

export function createStrategy(
  type: string,
  config?: Record<string, unknown>,
): SwarmStrategy {
  switch (type) {
    case 'debate':
      return new DebateStrategy({
        maxRounds: (config?.maxRounds as number) ?? 3,
        consensusThreshold: (config?.consensusThreshold as number) ?? 0.7,
      });
    case 'moa':
      return new MoAStrategy({
        layers: (config?.layers as number) ?? 2,
      });
    case 'pipeline':
      return new PipelineStrategy();
    case 'fan-out':
      return new FanOutGatherStrategy({
        maxParallel: (config?.maxParallel as number) ?? 8,
      });
    case 'generator-critic':
      return new GeneratorCriticStrategy({
        maxIterations: (config?.maxIterations as number) ?? 3,
        qualityThreshold: (config?.qualityThreshold as number) ?? 8,
      });
    default:
      throw new Error(`Unknown strategy: ${type}`);
  }
}
