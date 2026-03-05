import { AgentRole, ROLE_REGISTRY } from './roles';
import { SwarmScorer, ModelPerformance } from './scorer';
import { LLMProvider } from '../types';

// ─── Types ───────────────────────────────────────────────────────────────────

export type SwarmStrategyType =
  | 'debate'
  | 'moa'
  | 'pipeline'
  | 'fan-out'
  | 'generator-critic'
  | 'auto';

export interface ProviderSlot {
  providerName: string;
  model: string;
  provider: LLMProvider;
  tier: 'fast' | 'standard' | 'powerful';
  costPerMToken?: number;
}

export interface RoleAssignment {
  role: AgentRole;
  providerSlot: ProviderSlot;
  reason: string;
}

export interface RoutingDecision {
  strategy: SwarmStrategyType;
  assignments: RoleAssignment[];
  rationale: string;
  complexity: number;
  estimatedCost: number;
}

interface TaskAnalysis {
  complexity: number;
  parallelizable: number;
  needsIteration: number;
  needsDebate: number;
  isSequential: number;
  fileCount: number;
  wordCount: number;
}

// ─── Router ──────────────────────────────────────────────────────────────────

export class SwarmRouter {
  private providers: ProviderSlot[];
  private scorer: SwarmScorer;

  constructor(providers: ProviderSlot[], scorer: SwarmScorer) {
    this.providers = providers;
    this.scorer = scorer;
  }

  /**
   * Main entry point — analyze a task and produce a full routing decision.
   */
  route(
    task: string,
    context?: { files?: string[]; preferredStrategy?: SwarmStrategyType }
  ): RoutingDecision {
    if (
      context?.preferredStrategy &&
      context.preferredStrategy !== 'auto'
    ) {
      return this.buildDecision(context.preferredStrategy, task, context);
    }

    const analysis = this.analyzeTask(task, context?.files);
    const strategy = this.selectStrategy(analysis);
    return this.buildDecision(strategy, task, context);
  }

  // ─── Task Analysis ───────────────────────────────────────────────────────

  private analyzeTask(task: string, files?: string[]): TaskAnalysis {
    const words = task.split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const fileCount = files ? files.length : 0;

    let complexity = 0;
    let parallelizable = 0;
    let needsIteration = 0;
    let needsDebate = 0;
    let isSequential = 0;

    // ── Length scoring ────────────────────────────────────────────────────
    if (wordCount > 100) {
      complexity += 30;
    } else if (wordCount > 50) {
      complexity += 20;
    } else if (wordCount > 20) {
      complexity += 10;
    }

    // ── File count scoring ───────────────────────────────────────────────
    if (fileCount > 10) {
      complexity += 20;
      parallelizable += 30;
    } else if (fileCount > 3) {
      complexity += 10;
      parallelizable += 15;
    }

    // ── Regex-based pattern matching (case insensitive) ──────────────────

    // Debate signals
    if (/design|architect|decide|choose|compare|evaluate|best approach/i.test(task)) {
      needsDebate += 25;
    }
    if (/trade.?off|pros?\s+and\s+cons?|alternatives?/i.test(task)) {
      needsDebate += 30;
    }

    // Pipeline signals
    if (/then|after that|next step|phase|stage|first.*then/i.test(task)) {
      isSequential += 20;
    }
    const pipelineKeywords = ['plan', 'design', 'implement', 'test', 'review', 'deploy'];
    const pipelineMatches = pipelineKeywords.filter((kw) =>
      new RegExp(kw, 'i').test(task)
    );
    if (pipelineMatches.length >= 2) {
      isSequential += 25;
    }

    // Fan-out signals
    if (/all|every|each|across|multiple\s+files?|modules?|components?/i.test(task)) {
      parallelizable += 30;
    }
    if (/batch|bulk|mass\s+update|fix|refactor|migrate/i.test(task)) {
      parallelizable += 35;
    }

    // Iteration signals
    if (/optimize|improve|refine|polish|perfect|high.?quality/i.test(task)) {
      needsIteration += 20;
    }
    if (/security|audit|vulnerability|pentest|compliance/i.test(task)) {
      needsIteration += 15;
      complexity += 15;
    }

    // Complexity signals
    if (/complex|large.?scale|enterprise|production|critical/i.test(task)) {
      complexity += 20;
    }
    if (/from scratch|new project|greenfield|full.?stack/i.test(task)) {
      complexity += 25;
      isSequential += 15;
    }

    // Cap all dimensions at 100
    return {
      complexity: Math.min(complexity, 100),
      parallelizable: Math.min(parallelizable, 100),
      needsIteration: Math.min(needsIteration, 100),
      needsDebate: Math.min(needsDebate, 100),
      isSequential: Math.min(isSequential, 100),
      fileCount,
      wordCount,
    };
  }

  // ─── Strategy Selection ──────────────────────────────────────────────────

  private selectStrategy(analysis: TaskAnalysis): SwarmStrategyType {
    const candidates: [SwarmStrategyType, number][] = [
      ['debate', analysis.needsDebate],
      ['fan-out', analysis.parallelizable],
      ['generator-critic', analysis.needsIteration],
      ['pipeline', analysis.isSequential],
      ['moa', analysis.complexity],
    ];

    candidates.sort((a, b) => b[1] - a[1]);

    const [topStrategy, topScore] = candidates[0];

    if (topScore < 15) {
      if (analysis.fileCount > 5) return 'fan-out';
      if (analysis.complexity > 30) return 'moa';
      return 'pipeline';
    }

    return topStrategy;
  }

  // ─── Model Assignment ────────────────────────────────────────────────────

  private assignModels(
    strategy: SwarmStrategyType,
    analysis: TaskAnalysis
  ): RoleAssignment[] {
    const roles = this.getRolesForStrategy(strategy);
    const assignments: RoleAssignment[] = [];
    const usedProviders = new Set<string>();
    const needsDiversity = strategy === 'moa' || strategy === 'debate';

    for (const role of roles) {
      const roleInfo = ROLE_REGISTRY[role];
      const preferredTier = roleInfo?.preferredTier ?? 'standard';

      const excludeProviders = needsDiversity
        ? Array.from(usedProviders)
        : undefined;

      const providerSlot = this.selectBestProvider(
        preferredTier as 'fast' | 'standard' | 'powerful',
        role,
        excludeProviders
      );

      if (providerSlot) {
        usedProviders.add(providerSlot.providerName);

        assignments.push({
          role,
          providerSlot,
          reason: `${role} assigned to ${providerSlot.providerName}/${providerSlot.model} (${providerSlot.tier} tier)`,
        });
      }
    }

    return assignments;
  }

  // ─── Roles per Strategy ──────────────────────────────────────────────────

  private getRolesForStrategy(strategy: SwarmStrategyType): AgentRole[] {
    switch (strategy) {
      case 'debate':
        return ['coder', 'coder', 'coder', 'synthesizer'];
      case 'moa':
        return ['coder', 'coder', 'coder', 'synthesizer'];
      case 'pipeline':
        return ['planner', 'researcher', 'architect', 'coder', 'reviewer', 'tester'];
      case 'fan-out':
        return ['planner', 'coder', 'coder', 'coder', 'synthesizer'];
      case 'generator-critic':
        return ['coder', 'reviewer'];
      default:
        return ['coder'];
    }
  }

  // ─── Provider Selection ──────────────────────────────────────────────────

  private selectBestProvider(
    tier: 'fast' | 'standard' | 'powerful',
    role: AgentRole,
    excludeProviders?: string[]
  ): ProviderSlot | null {
    let candidates = this.providers.filter((p) => p.tier === tier);

    if (excludeProviders && excludeProviders.length > 0) {
      const filtered = candidates.filter(
        (p) => !excludeProviders.includes(p.providerName)
      );
      if (filtered.length > 0) {
        candidates = filtered;
      }
    }

    // Fallback: if no candidates match the requested tier, use any provider
    if (candidates.length === 0) {
      candidates = [...this.providers];
      if (excludeProviders && excludeProviders.length > 0) {
        const filtered = candidates.filter(
          (p) => !excludeProviders.includes(p.providerName)
        );
        if (filtered.length > 0) {
          candidates = filtered;
        }
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    // Check scorer for historical performance and sort
    const scored = candidates.map((slot) => {
      const perf = this.scorer.getModelPerformance(slot.model, role);
      return { slot, perf };
    });

    scored.sort((a, b) => {
      const perfA = a.perf?.avgScore ?? 0;
      const perfB = b.perf?.avgScore ?? 0;
      if (perfB !== perfA) return perfB - perfA;

      const costA = a.slot.costPerMToken ?? 0;
      const costB = b.slot.costPerMToken ?? 0;
      return costA - costB;
    });

    return scored[0].slot;
  }

  // ─── Decision Building ───────────────────────────────────────────────────

  private buildDecision(
    strategy: SwarmStrategyType,
    task: string,
    context?: { files?: string[]; preferredStrategy?: SwarmStrategyType }
  ): RoutingDecision {
    const analysis = this.analyzeTask(task, context?.files);
    const assignments = this.assignModels(strategy, analysis);
    const rationale = this.buildRationale(strategy, analysis);
    const estimatedCost = this.estimateCost(assignments);

    return {
      strategy,
      assignments,
      rationale,
      complexity: analysis.complexity,
      estimatedCost,
    };
  }

  // ─── Rationale ───────────────────────────────────────────────────────────

  private buildRationale(
    strategy: SwarmStrategyType,
    analysis: TaskAnalysis
  ): string {
    const parts: string[] = [];

    parts.push(
      `Selected "${strategy}" strategy for a task with ${analysis.wordCount} words` +
        (analysis.fileCount > 0 ? ` across ${analysis.fileCount} files` : '') +
        '.'
    );

    if (analysis.complexity > 50) {
      parts.push(`High complexity score (${analysis.complexity}/100) indicates a challenging task.`);
    } else if (analysis.complexity > 25) {
      parts.push(`Moderate complexity score (${analysis.complexity}/100).`);
    } else {
      parts.push(`Low complexity score (${analysis.complexity}/100).`);
    }

    switch (strategy) {
      case 'debate':
        parts.push(
          `Debate score of ${analysis.needsDebate} suggests multiple perspectives would produce better decisions.`
        );
        break;
      case 'moa':
        parts.push(
          `Mixture-of-agents approach chosen to leverage diverse model strengths for this complex task.`
        );
        break;
      case 'pipeline':
        parts.push(
          `Sequential score of ${analysis.isSequential} indicates a step-by-step pipeline is optimal.`
        );
        break;
      case 'fan-out':
        parts.push(
          `Parallelizability score of ${analysis.parallelizable} favors distributing work across agents.`
        );
        break;
      case 'generator-critic':
        parts.push(
          `Iteration score of ${analysis.needsIteration} benefits from a generate-then-critique loop.`
        );
        break;
    }

    return parts.join(' ');
  }

  // ─── Cost Estimation ─────────────────────────────────────────────────────

  private estimateCost(assignments: RoleAssignment[]): number {
    const tokensPerAgent = 10_000; // ~10K tokens per agent
    let totalCost = 0;

    for (const assignment of assignments) {
      const costPerMToken = assignment.providerSlot.costPerMToken ?? 0;
      totalCost += (tokensPerAgent / 1_000_000) * costPerMToken;
    }

    return totalCost;
  }
}
