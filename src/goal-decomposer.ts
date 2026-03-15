/**
 * Autonomous Goal Decomposition Engine
 *
 * Receives a high-level goal, breaks it into a dependency-ordered subtask tree,
 * and tracks execution state. Works with the Orchestrator to delegate subtasks
 * to child agents when beneficial.
 *
 * Goal tree structure:
 *   Root Goal ──┬── SubGoal A (depth 1) ──┬── SubGoal A1 (depth 2)
 *               │                          └── SubGoal A2 (depth 2)
 *               └── SubGoal B (depth 1)
 *
 * Max depth is configurable (default 3). Each node tracks its own status
 * and dependency edges so the executor can determine ready-to-run order.
 */

// ── Types ──

export type GoalStatus = 'pending' | 'ready' | 'in_progress' | 'completed' | 'failed' | 'skipped';

export interface GoalNode {
  id: string;
  description: string;
  parentId: string | null;
  depth: number;
  status: GoalStatus;
  /** IDs of goals that must complete before this one can start */
  dependencies: string[];
  /** IDs of direct child subgoals */
  subtasks: string[];
  /** Tool hint — suggested tool to use for leaf goals */
  toolHint?: string;
  /** Context files relevant to this goal */
  context?: string[];
  /** Output from execution (summary text) */
  output?: string;
  /** Error message if failed */
  error?: string;
  /** Timestamp */
  createdAt: string;
  completedAt?: string;
}

export interface GoalTree {
  rootId: string;
  nodes: Map<string, GoalNode>;
  maxDepth: number;
  /** Original high-level goal text */
  originalGoal: string;
  createdAt: string;
}

export interface DecompositionStrategy {
  name: string;
  /** Pattern-match on the goal description */
  match: (goal: string) => boolean;
  /** Generate subtask descriptions from the goal */
  decompose: (goal: string) => SubtaskDraft[];
}

export interface SubtaskDraft {
  description: string;
  toolHint?: string;
  context?: string[];
  dependencies?: string[]; // references by relative index (e.g., "0" = first sibling)
}

// ── Goal Decomposer ──

export class GoalDecomposer {
  private strategies: DecompositionStrategy[];
  private maxDepth: number;
  private idCounter = 0;

  constructor(maxDepth = 3) {
    this.maxDepth = maxDepth;
    this.strategies = buildDefaultStrategies();
  }

  /** Generate a unique goal ID */
  private nextId(): string {
    return `goal_${++this.idCounter}_${Date.now().toString(36)}`;
  }

  /**
   * Decompose a high-level goal into a GoalTree.
   * Uses heuristic strategies first, returns a flat single-node tree
   * if no strategy matches (the agent can further decompose at runtime).
   */
  decompose(goal: string, context?: string[]): GoalTree {
    const rootId = this.nextId();
    const now = new Date().toISOString();

    const root: GoalNode = {
      id: rootId,
      description: goal,
      parentId: null,
      depth: 0,
      status: 'pending',
      dependencies: [],
      subtasks: [],
      context,
      createdAt: now,
    };

    const tree: GoalTree = {
      rootId,
      nodes: new Map([[rootId, root]]),
      maxDepth: this.maxDepth,
      originalGoal: goal,
      createdAt: now,
    };

    // Try heuristic decomposition
    this.expandNode(tree, root);
    // Recompute readiness
    this.updateReadyStates(tree);

    return tree;
  }

  /**
   * Recursively expand a node using matching strategies.
   * Stops at maxDepth or when no strategy matches.
   */
  private expandNode(tree: GoalTree, node: GoalNode): void {
    if (node.depth >= this.maxDepth) return;

    const strategy = this.strategies.find(s => s.match(node.description));
    if (!strategy) return;

    const drafts = strategy.decompose(node.description);
    if (drafts.length === 0) return;

    // Map relative dependency indices to actual IDs
    const childIds: string[] = [];

    for (const draft of drafts) {
      const childId = this.nextId();
      childIds.push(childId);

      const child: GoalNode = {
        id: childId,
        description: draft.description,
        parentId: node.id,
        depth: node.depth + 1,
        status: 'pending',
        dependencies: [],
        subtasks: [],
        toolHint: draft.toolHint,
        context: draft.context || node.context,
        createdAt: new Date().toISOString(),
      };

      // Resolve relative dependency references
      if (draft.dependencies) {
        for (const ref of draft.dependencies) {
          const idx = parseInt(ref, 10);
          if (!isNaN(idx) && idx >= 0 && idx < childIds.length) {
            child.dependencies.push(childIds[idx]);
          }
        }
      }

      tree.nodes.set(childId, child);

      // Recurse
      this.expandNode(tree, child);
    }

    node.subtasks = childIds;
  }

  /**
   * Add subtasks to an existing node at runtime (LLM-generated decomposition).
   */
  addSubtasks(tree: GoalTree, parentId: string, drafts: SubtaskDraft[]): GoalNode[] {
    const parent = tree.nodes.get(parentId);
    if (!parent) throw new Error(`Parent goal ${parentId} not found`);
    if (parent.depth >= tree.maxDepth) {
      throw new Error(`Cannot decompose further: max depth ${tree.maxDepth} reached`);
    }

    const created: GoalNode[] = [];
    const childIds: string[] = [];

    for (const draft of drafts) {
      const childId = this.nextId();
      childIds.push(childId);

      const child: GoalNode = {
        id: childId,
        description: draft.description,
        parentId: parent.id,
        depth: parent.depth + 1,
        status: 'pending',
        dependencies: [],
        subtasks: [],
        toolHint: draft.toolHint,
        context: draft.context || parent.context,
        createdAt: new Date().toISOString(),
      };

      if (draft.dependencies) {
        for (const ref of draft.dependencies) {
          const idx = parseInt(ref, 10);
          if (!isNaN(idx) && idx >= 0 && idx < childIds.length) {
            child.dependencies.push(childIds[idx]);
          }
        }
      }

      tree.nodes.set(childId, child);
      created.push(child);
    }

    parent.subtasks.push(...childIds);
    this.updateReadyStates(tree);
    return created;
  }

  /**
   * Mark a goal as completed and propagate status up the tree.
   */
  complete(tree: GoalTree, goalId: string, output?: string): void {
    const node = tree.nodes.get(goalId);
    if (!node) return;

    node.status = 'completed';
    node.output = output;
    node.completedAt = new Date().toISOString();

    // Check if parent's subtasks are all done
    if (node.parentId) {
      this.checkParentCompletion(tree, node.parentId);
    }

    this.updateReadyStates(tree);
  }

  /**
   * Mark a goal as failed. Parent remains in_progress (other subtasks may still run).
   */
  fail(tree: GoalTree, goalId: string, error: string): void {
    const node = tree.nodes.get(goalId);
    if (!node) return;

    node.status = 'failed';
    node.error = error;
    node.completedAt = new Date().toISOString();

    // Skip dependents since this goal failed
    this.skipDependents(tree, goalId);

    // Check if parent can resolve now
    if (node.parentId) {
      this.checkParentCompletion(tree, node.parentId);
    }

    this.updateReadyStates(tree);
  }

  /**
   * Get the next goal(s) that are ready to execute.
   * Returns leaf nodes (no subtasks) that are 'ready'.
   */
  getReady(tree: GoalTree): GoalNode[] {
    const ready: GoalNode[] = [];
    for (const node of tree.nodes.values()) {
      if (node.status === 'ready' && node.subtasks.length === 0) {
        ready.push(node);
      }
    }
    return ready;
  }

  /**
   * Check if the entire tree is finished (root completed or failed).
   */
  isFinished(tree: GoalTree): boolean {
    const root = tree.nodes.get(tree.rootId);
    return root?.status === 'completed' || root?.status === 'failed';
  }

  /**
   * Get a summary of the tree state.
   */
  summarize(tree: GoalTree): string {
    const counts: Record<GoalStatus, number> = {
      pending: 0, ready: 0, in_progress: 0, completed: 0, failed: 0, skipped: 0,
    };
    for (const node of tree.nodes.values()) {
      counts[node.status]++;
    }

    const root = tree.nodes.get(tree.rootId)!;
    const lines = [
      `Goal: ${root.description}`,
      `Status: ${root.status}`,
      `Nodes: ${tree.nodes.size} (${counts.completed} done, ${counts.ready} ready, ${counts.in_progress} running, ${counts.failed} failed, ${counts.skipped} skipped, ${counts.pending} pending)`,
      '',
      ...this.formatSubtree(tree, tree.rootId, 0),
    ];
    return lines.join('\n');
  }

  /**
   * Serialize tree to plain object for JSON storage.
   */
  serialize(tree: GoalTree): Record<string, unknown> {
    const nodes: Record<string, GoalNode> = {};
    for (const [id, node] of tree.nodes) {
      nodes[id] = { ...node };
    }
    return {
      rootId: tree.rootId,
      nodes,
      maxDepth: tree.maxDepth,
      originalGoal: tree.originalGoal,
      createdAt: tree.createdAt,
    };
  }

  /**
   * Deserialize from plain object.
   */
  deserialize(data: Record<string, unknown>): GoalTree {
    const nodesObj = data.nodes as Record<string, GoalNode>;
    const nodes = new Map<string, GoalNode>();
    for (const [id, node] of Object.entries(nodesObj)) {
      nodes.set(id, node);
    }
    return {
      rootId: data.rootId as string,
      nodes,
      maxDepth: (data.maxDepth as number) || this.maxDepth,
      originalGoal: data.originalGoal as string,
      createdAt: data.createdAt as string,
    };
  }

  // ── Internal helpers ──

  private updateReadyStates(tree: GoalTree): void {
    const completedIds = new Set<string>();
    for (const node of tree.nodes.values()) {
      if (node.status === 'completed') completedIds.add(node.id);
    }

    for (const node of tree.nodes.values()) {
      if (node.status !== 'pending') continue;

      // A node is ready if all its dependencies are completed
      const depsReady = node.dependencies.every(d => completedIds.has(d));
      if (depsReady) {
        // If it has subtasks, don't mark ready — its children run instead
        if (node.subtasks.length === 0) {
          node.status = 'ready';
        } else {
          // Mark as in_progress — subtasks will be scheduled
          node.status = 'in_progress';
        }
      }
    }
  }

  private checkParentCompletion(tree: GoalTree, parentId: string): void {
    const parent = tree.nodes.get(parentId);
    if (!parent) return;

    const terminalStatuses = new Set(['completed', 'skipped', 'failed']);
    const allTerminal = parent.subtasks.every(id => {
      const child = tree.nodes.get(id);
      return child && terminalStatuses.has(child.status);
    });

    if (!allTerminal) return; // Wait for all children to finish

    const anyFailed = parent.subtasks.some(id => {
      const child = tree.nodes.get(id);
      return child?.status === 'failed';
    });

    if (anyFailed) {
      parent.status = 'failed';
      parent.error = 'One or more subtasks failed';
      parent.completedAt = new Date().toISOString();
    } else {
      parent.status = 'completed';
      parent.completedAt = new Date().toISOString();
      // Collect subtask outputs
      const outputs = parent.subtasks
        .map(id => tree.nodes.get(id))
        .filter(n => n?.output)
        .map(n => n!.output);
      if (outputs.length > 0) {
        parent.output = outputs.join('\n---\n');
      }
    }

    // Recurse up
    if (parent.parentId && (parent.status === 'completed' || parent.status === 'failed')) {
      this.checkParentCompletion(tree, parent.parentId);
    }
  }

  private skipDependents(tree: GoalTree, failedId: string): void {
    for (const node of tree.nodes.values()) {
      if (node.dependencies.includes(failedId) && node.status === 'pending') {
        node.status = 'skipped';
        // Recursively skip dependents of skipped nodes
        this.skipDependents(tree, node.id);
      }
    }
  }

  private formatSubtree(tree: GoalTree, nodeId: string, indent: number): string[] {
    const node = tree.nodes.get(nodeId);
    if (!node) return [];

    const prefix = '  '.repeat(indent);
    const icon = statusIcon(node.status);
    const lines = [`${prefix}${icon} [${node.status}] ${node.description}`];

    for (const childId of node.subtasks) {
      lines.push(...this.formatSubtree(tree, childId, indent + 1));
    }

    return lines;
  }
}

function statusIcon(status: GoalStatus): string {
  switch (status) {
    case 'completed': return '[x]';
    case 'ready': return '[ ]';
    case 'in_progress': return '[~]';
    case 'failed': return '[!]';
    case 'skipped': return '[-]';
    default: return '[ ]';
  }
}

// ── Default Decomposition Strategies ──

function buildDefaultStrategies(): DecompositionStrategy[] {
  return [
    {
      name: 'bug-fix',
      match: (g) => /\b(fix|bug|error|crash|broken|issue|debug)\b/i.test(g),
      decompose: (g) => [
        { description: `Search codebase for error patterns related to: ${truncate(g, 80)}`, toolHint: 'grep' },
        { description: `Read and analyze relevant source files`, toolHint: 'read_file', dependencies: ['0'] },
        { description: `Implement fix for: ${truncate(g, 80)}`, toolHint: 'edit_file', dependencies: ['1'] },
        { description: `Run tests to verify the fix`, toolHint: 'test_runner', dependencies: ['2'] },
      ],
    },
    {
      name: 'feature-add',
      match: (g) => /\b(add|create|implement|build|new feature|introduce)\b/i.test(g),
      decompose: (g) => [
        { description: `Analyze existing codebase for patterns and conventions`, toolHint: 'code_analysis' },
        { description: `Plan implementation approach for: ${truncate(g, 80)}`, toolHint: 'think', dependencies: ['0'] },
        { description: `Implement the feature: ${truncate(g, 80)}`, toolHint: 'write_file', dependencies: ['1'] },
        { description: `Write tests for the new feature`, toolHint: 'write_file', dependencies: ['2'] },
        { description: `Run full test suite to verify`, toolHint: 'test_runner', dependencies: ['3'] },
      ],
    },
    {
      name: 'refactor',
      match: (g) => /\b(refactor|restructure|reorganize|clean up|simplify|optimize)\b/i.test(g),
      decompose: (g) => [
        { description: `Identify all files affected by: ${truncate(g, 80)}`, toolHint: 'grep' },
        { description: `Run tests to establish baseline (before refactor)`, toolHint: 'test_runner' },
        { description: `Apply refactoring changes`, toolHint: 'edit_file', dependencies: ['0', '1'] },
        { description: `Run tests to verify no regressions`, toolHint: 'test_runner', dependencies: ['2'] },
      ],
    },
    {
      name: 'test-suite',
      match: (g) => /\b(test|spec|coverage|write tests)\b/i.test(g),
      decompose: (g) => [
        { description: `Analyze code under test for: ${truncate(g, 80)}`, toolHint: 'read_file' },
        { description: `Write test cases`, toolHint: 'write_file', dependencies: ['0'] },
        { description: `Run tests and verify they pass`, toolHint: 'test_runner', dependencies: ['1'] },
      ],
    },
    {
      name: 'deploy-release',
      match: (g) => /\b(deploy|release|ship|publish|push to prod)\b/i.test(g),
      decompose: (g) => [
        { description: `Run full test suite before deploy`, toolHint: 'test_runner' },
        { description: `Build production artifacts`, toolHint: 'execute', dependencies: ['0'] },
        { description: `Execute deployment for: ${truncate(g, 80)}`, toolHint: 'execute', dependencies: ['1'] },
        { description: `Verify deployment health`, toolHint: 'execute', dependencies: ['2'] },
      ],
    },
    {
      name: 'research-investigate',
      match: (g) => /\b(research|investigate|explore|understand|analyze|audit)\b/i.test(g),
      decompose: (g) => [
        { description: `Search codebase for: ${truncate(g, 80)}`, toolHint: 'grep' },
        { description: `Read and analyze discovered files`, toolHint: 'read_file', dependencies: ['0'] },
        { description: `Synthesize findings into summary`, toolHint: 'think', dependencies: ['1'] },
      ],
    },
  ];
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.substring(0, max - 3) + '...' : s;
}
