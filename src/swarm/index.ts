import { EventEmitter } from 'events';
import { LLMProvider, Tool } from '../types';
import { PolicyEnforcer } from '../policy';
import { MetricsCollector } from '../metrics';
import { ContextBus } from './context-bus';
import { BusBridgeTool } from './context-bus';
import { SwarmRouter, ProviderSlot, RoutingDecision, SwarmStrategyType, RoleAssignment } from './router';
import { SwarmScorer, AgentScore } from './scorer';
import { AgentRole, ROLE_REGISTRY, getToolsForRole, buildRoleSystemPrompt } from './roles';
import { SwarmStrategy, SwarmAgent, AgentRunResult, AgentContribution, SwarmEvent, createStrategy } from './strategies';

// ── Barrel re-exports ──────────────────────────────────────────────────────────

export { ContextBus, BusBridgeTool } from './context-bus';
export { AgentRole, ROLE_REGISTRY, RoleConfig, getToolsForRole, buildRoleSystemPrompt } from './roles';
export { SwarmScorer, AgentScore, ScoreFactor, ModelPerformance } from './scorer';
export { SwarmRouter, ProviderSlot, RoutingDecision, RoleAssignment, SwarmStrategyType } from './router';
export { SwarmStrategy, SwarmAgent, AgentRunResult, AgentContribution, SwarmEvent, createStrategy } from './strategies';

// ── SwarmConfig ────────────────────────────────────────────────────────────────

export interface SwarmConfig {
  maxTotalAgents: number;
  maxConcurrentAgents: number;
  maxDepth: number;
  agentTimeoutMs: number;
  maxTotalToolCalls: number;
  adaptiveQuality: boolean;
  strategyOverride: SwarmStrategyType | null;
  providers: ProviderSlot[];
}

const DEFAULT_SWARM_CONFIG: SwarmConfig = {
  maxTotalAgents: 50,
  maxConcurrentAgents: 8,
  maxDepth: 5,
  agentTimeoutMs: 180_000,
  maxTotalToolCalls: 2000,
  adaptiveQuality: true,
  strategyOverride: null,
  providers: [],
};

// ── SwarmTaskContext ───────────────────────────────────────────────────────────

export interface SwarmTaskContext {
  files?: string[];
  parentSwarmId?: string;
  preferredStrategy?: SwarmStrategyType;
  preferredModels?: string[];
  budgetUsd?: number;
}

// ── SwarmState ─────────────────────────────────────────────────────────────────

export interface SwarmState {
  swarmId: string;
  strategy: SwarmStrategyType;
  status: 'idle' | 'running' | 'complete' | 'error';
  totalAgents: number;
  activeAgents: number;
  completedAgents: number;
  totalToolCalls: number;
  currentRound: number;
  agents: Array<{
    id: string;
    role: AgentRole;
    model: string;
    status: string;
    contributions: number;
  }>;
  elapsed: number;
  startedAt: number;
}

// ── AgentFactory ───────────────────────────────────────────────────────────────

/** Factory function that the host (Agent class) provides to create child agents */
export type AgentFactory = (
  role: AgentRole,
  model: string,
  providerName: string,
  systemPromptSuffix: string,
  allowedTools: string[],
  maxIterations: number,
) => SwarmAgent;

// ── SwarmOrchestrator ──────────────────────────────────────────────────────────

export class SwarmOrchestrator {
  private readonly config: SwarmConfig;
  private readonly policyEnforcer: PolicyEnforcer;
  private readonly metrics: MetricsCollector;
  private contextBus: ContextBus;
  private readonly router: SwarmRouter;
  private readonly scorer: SwarmScorer;
  private activeAgents: Map<string, SwarmAgent> = new Map();
  private completedAgents: SwarmAgent[] = [];
  private totalSpawned: number = 0;
  private totalToolCalls: number = 0;
  private swarmId: string = '';
  private readonly depth: number;
  private readonly events: EventEmitter = new EventEmitter();
  private state: SwarmState;
  private agentFactory: AgentFactory | null = null;

  constructor(
    policyEnforcer: PolicyEnforcer,
    metrics: MetricsCollector,
    config: Partial<SwarmConfig> = {},
    depth: number = 0,
  ) {
    this.config = { ...DEFAULT_SWARM_CONFIG, ...config };
    this.policyEnforcer = policyEnforcer;
    this.metrics = metrics;
    this.depth = depth;

    this.scorer = new SwarmScorer();
    this.router = new SwarmRouter(this.config.providers, this.scorer);
    this.contextBus = new ContextBus('');

    this.state = {
      swarmId: '',
      strategy: 'parallel' as SwarmStrategyType,
      status: 'idle',
      totalAgents: 0,
      activeAgents: 0,
      completedAgents: 0,
      totalToolCalls: 0,
      currentRound: 0,
      agents: [],
      elapsed: 0,
      startedAt: 0,
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  setAgentFactory(factory: AgentFactory): void {
    this.agentFactory = factory;
  }

  async *execute(
    task: string,
    context?: SwarmTaskContext,
    factory?: AgentFactory,
  ): AsyncGenerator<SwarmEvent> {
    // Generate a unique swarm id
    this.swarmId = `swarm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    // Fresh context bus per execution
    this.contextBus = new ContextBus(this.swarmId);

    // Accept an inline factory if provided
    if (factory) {
      this.agentFactory = factory;
    }

    // Guard: can we still spawn?
    if (!this.canSpawn()) {
      yield {
        type: 'swarm_error',
        swarmId: this.swarmId,
        timestamp: Date.now(),
        data: {
          error: `Cannot spawn: depth=${this.depth} (max ${this.config.maxDepth}), ` +
                 `totalSpawned=${this.totalSpawned} (max ${this.config.maxTotalAgents})`,
        },
      } as SwarmEvent;
      return;
    }

    // Update state
    this.state = {
      swarmId: this.swarmId,
      strategy: 'parallel' as SwarmStrategyType,
      status: 'running',
      totalAgents: 0,
      activeAgents: 0,
      completedAgents: 0,
      totalToolCalls: 0,
      currentRound: 0,
      agents: [],
      elapsed: 0,
      startedAt: Date.now(),
    };

    // Yield swarm_start
    yield {
      type: 'swarm_start',
      swarmId: this.swarmId,
      timestamp: Date.now(),
      data: {
        task,
        depth: this.depth,
        config: this.config,
      },
    } as SwarmEvent;

    // Route the task
    const decision: RoutingDecision = this.router.route(task, context);
    this.state.strategy = decision.strategy;

    // Yield strategy_selected
    yield {
      type: 'strategy_selected',
      swarmId: this.swarmId,
      timestamp: Date.now(),
      data: {
        strategy: decision.strategy,
        assignments: decision.assignments,
        rationale: decision.rationale,
      },
    } as SwarmEvent;

    // Create the strategy instance
    const strategy: SwarmStrategy = createStrategy(decision.strategy, {});

    // Provision agents from the routing decision
    const agents = this.provisionAgents(decision.assignments, task);
    this.state.totalAgents = agents.length;
    this.state.activeAgents = agents.length;

    // Run the strategy — forward all events
    const contributions: AgentContribution[] = [];

    for await (const event of strategy.execute(agents, task, this.contextBus, this.swarmId)) {
      yield event;

      // Track agent completion
      if (event.type === 'agent_complete') {
        this.state.completedAgents++;
        this.state.activeAgents = Math.max(0, this.state.activeAgents - 1);
      }

      if (event.type === 'round_end') {
        this.state.currentRound++;
      }
    }

    // The strategy generator returns contributions via its return value.
    // Since AsyncGenerator return values are not accessible via for-await-of,
    // we collect contributions from the context bus instead.
    const allMessages = this.contextBus.getAllMessages();
    for (const msg of allMessages) {
      if (msg.type === 'contribution') {
        const matchingAgent = agents.find(a => a.id === msg.fromAgentId);
        if (matchingAgent) {
          contributions.push({
            agentId: msg.fromAgentId,
            role: matchingAgent.role,
            model: matchingAgent.model,
            round: msg.round ?? 0,
            content: msg.payload.content,
            toolCalls: [],
            filesModified: msg.payload.files ?? [],
            durationMs: 0,
            tokenUsage: { input: 0, output: 0 },
          });
        }
      }
    }

    // Score every completed agent
    for (const agent of agents) {
      // Find contribution for this agent
      const agentContrib = contributions.find(c => c.agentId === agent.id);
      if (agentContrib) {
        this.scorer.scoreAgent(agent.id, agent.model, agent.role, {
          content: agentContrib.content,
          toolCalls: agentContrib.toolCalls,
          filesModified: agentContrib.filesModified,
          durationMs: agentContrib.durationMs,
          tokenUsage: agentContrib.tokenUsage,
          errors: 0,
        });
      }
      this.completedAgents.push(agent);
      this.activeAgents.delete(agent.id);
    }

    // Yield swarm_complete
    const elapsed = Date.now() - this.state.startedAt;
    this.state.elapsed = elapsed;
    this.state.status = 'complete';
    this.state.activeAgents = 0;

    yield {
      type: 'swarm_complete',
      swarmId: this.swarmId,
      timestamp: Date.now(),
      data: {
        totalAgents: agents.length,
        contributions,
        elapsed,
        totalToolCalls: this.totalToolCalls,
      },
    } as SwarmEvent;
  }

  getState(): SwarmState {
    if (this.state.startedAt > 0 && this.state.status === 'running') {
      this.state.elapsed = Date.now() - this.state.startedAt;
    }
    return { ...this.state };
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }

  getScorer(): SwarmScorer {
    return this.scorer;
  }

  getRouter(): SwarmRouter {
    return this.router;
  }

  getBus(): ContextBus {
    return this.contextBus;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private provisionAgents(
    assignments: RoleAssignment[],
    task: string,
  ): SwarmAgent[] {
    const agents: SwarmAgent[] = [];

    for (let i = 0; i < assignments.length; i++) {
      const assignment = assignments[i];
      const agentId = `agent_${this.swarmId}_${i}`;
      const roleConfig = ROLE_REGISTRY[assignment.role];
      const systemSuffix = roleConfig
        ? buildRoleSystemPrompt('', assignment.role)
        : '';
      const allowedTools: string[] = roleConfig
        ? getToolsForRole(assignment.role, []).map((t: Tool) => t.name)
        : [];

      let agent: SwarmAgent;

      if (this.agentFactory) {
        agent = this.agentFactory(
          assignment.role,
          assignment.providerSlot.model,
          assignment.providerSlot.providerName,
          systemSuffix,
          allowedTools,
          roleConfig?.maxIterations ?? 25,
        );
        // Ensure the agent has the generated id
        agent.id = agentId;
      } else {
        // Stub agent when no factory is available
        agent = {
          id: agentId,
          role: assignment.role,
          model: assignment.providerSlot.model,
          providerName: assignment.providerSlot.providerName,
          status: 'idle' as const,
          depth: 0,
          async run(_task: string): Promise<AgentRunResult> {
            return {
              output: `[stub] No agent factory configured`,
              toolCalls: [],
              filesModified: [],
              durationMs: 0,
              tokenUsage: { input: 0, output: 0 },
              errors: 0,
            };
          },
        } as SwarmAgent;
      }

      this.activeAgents.set(agentId, agent);
      this.totalSpawned++;
      agents.push(agent);

      // Update state tracking
      this.state.agents.push({
        id: agentId,
        role: assignment.role,
        model: assignment.providerSlot.model,
        status: 'provisioned',
        contributions: 0,
      });
    }

    return agents;
  }

  private canSpawn(): boolean {
    if (this.depth >= this.config.maxDepth) {
      return false;
    }
    if (this.totalSpawned >= this.config.maxTotalAgents) {
      return false;
    }
    return true;
  }
}
