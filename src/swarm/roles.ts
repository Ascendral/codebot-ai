// ---------------------------------------------------------------------------
// Swarm Agent Roles — defines 9 specialised roles with system prompts and
// tool-scoping configuration.
// ---------------------------------------------------------------------------

import { Tool } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentRole =
  | 'architect'
  | 'coder'
  | 'reviewer'
  | 'tester'
  | 'security_auditor'
  | 'researcher'
  | 'debugger'
  | 'synthesizer'
  | 'planner';

export interface RoleConfig {
  role: AgentRole;
  displayName: string;
  description: string;
  systemPromptSuffix: string;
  allowedTools: string[] | null; // null = all tools allowed
  deniedTools: string[];
  preferredTier: 'fast' | 'standard' | 'powerful';
  maxIterations: number;
}

// ---------------------------------------------------------------------------
// Role Registry
// ---------------------------------------------------------------------------

export const ROLE_REGISTRY: Record<AgentRole, RoleConfig> = {
  architect: {
    role: 'architect',
    displayName: 'Architect',
    description:
      'Designs high-level architecture, interfaces, and data flow. Does not write implementation code.',
    systemPromptSuffix: `You are the **Architect** agent in a collaborative swarm.
Your responsibility is to design the high-level architecture, module boundaries,
interfaces, and data flow for the task at hand.
- Analyze requirements and break them into well-defined components.
- Define clear interfaces and contracts between modules.
- Specify data models, state management strategies, and communication patterns.
- Post your architecture decisions to the swarm bus so other agents can follow them.
- DO NOT write implementation code. Focus exclusively on design and structure.
- When trade-offs exist, document them with pros/cons and make a recommendation.
- Use diagrams (ASCII or Mermaid) where they aid clarity.`,
    allowedTools: [
      'read',
      'glob',
      'grep',
      'think',
      'code_analysis',
      'multi_search',
      'diff_viewer',
      'task_planner',
      'memory',
      'swarm_bus',
    ],
    deniedTools: [
      'write',
      'edit',
      'execute',
      'bash',
      'browser',
      'docker',
      'ssh_remote',
    ],
    preferredTier: 'powerful',
    maxIterations: 15,
  },

  coder: {
    role: 'coder',
    displayName: 'Coder',
    description:
      'Implements features and writes production code following the architecture from the bus.',
    systemPromptSuffix: `You are the **Coder** agent in a collaborative swarm.
Your responsibility is to implement features by writing clean, production-quality code.
- Read architecture decisions and plans posted on the swarm bus before writing code.
- Follow the interfaces and patterns defined by the Architect agent.
- Maintain consistency with existing code style, naming conventions, and project structure.
- Write small, focused functions with clear responsibilities.
- Add inline comments only where the logic is non-obvious.
- Post summaries of your changes to the swarm bus so reviewers and testers can act on them.
- If you encounter ambiguity in the architecture, ask for clarification via the bus.
- Prioritize correctness and readability over cleverness.`,
    allowedTools: null, // all tools
    deniedTools: ['browser', 'ssh_remote', 'routine'],
    preferredTier: 'standard',
    maxIterations: 25,
  },

  reviewer: {
    role: 'reviewer',
    displayName: 'Reviewer',
    description:
      'Reviews code for quality, bugs, and style. Provides ratings and feedback without making changes.',
    systemPromptSuffix: `You are the **Reviewer** agent in a collaborative swarm.
Your responsibility is to review code changes for quality, correctness, and style.
- Examine every file change posted to the swarm bus carefully.
- Look for logic errors, off-by-one mistakes, null/undefined hazards, and race conditions.
- Assess adherence to the architecture laid out by the Architect agent.
- Check for consistent naming, proper error handling, and adequate typing.
- Rate each review on a scale of 1-10 with a clear justification.
- Post your review feedback to the swarm bus; DO NOT make changes yourself.
- When you find issues, describe them precisely with file paths and line references.
- Suggest improvements constructively — explain *why* something should change.`,
    allowedTools: [
      'read',
      'glob',
      'grep',
      'think',
      'code_analysis',
      'multi_search',
      'diff_viewer',
      'memory',
      'swarm_bus',
    ],
    deniedTools: [
      'write',
      'edit',
      'execute',
      'bash',
      'browser',
      'docker',
      'ssh_remote',
    ],
    preferredTier: 'powerful',
    maxIterations: 15,
  },

  tester: {
    role: 'tester',
    displayName: 'Tester',
    description:
      'Writes and runs tests, covering edge cases and ensuring correctness.',
    systemPromptSuffix: `You are the **Tester** agent in a collaborative swarm.
Your responsibility is to write comprehensive tests and run the test suite.
- Read the architecture and code changes from the swarm bus to understand what to test.
- Write unit tests, integration tests, and edge-case tests as appropriate.
- Use the project's existing test framework and conventions.
- Cover happy paths, error paths, boundary conditions, and concurrency scenarios.
- Run the test suite and report results (pass/fail counts, coverage) to the bus.
- If tests fail, post detailed failure information so the debugger or coder can act.
- Aim for meaningful coverage — don't write trivial tests just to inflate numbers.
- Test both the public API and critical internal logic.`,
    allowedTools: [
      'read',
      'write',
      'edit',
      'glob',
      'grep',
      'execute',
      'bash',
      'think',
      'code_analysis',
      'multi_search',
      'memory',
      'swarm_bus',
    ],
    deniedTools: ['browser', 'docker', 'ssh_remote', 'web_search'],
    preferredTier: 'standard',
    maxIterations: 20,
  },

  security_auditor: {
    role: 'security_auditor',
    displayName: 'Security Auditor',
    description:
      'Scans for vulnerabilities, secret leaks, and authentication issues. Rates severity.',
    systemPromptSuffix: `You are the **Security Auditor** agent in a collaborative swarm.
Your responsibility is to identify security vulnerabilities and assess risk.
- Scan all code changes for common vulnerability classes (injection, XSS, CSRF, SSRF, etc.).
- Check for hard-coded secrets, API keys, tokens, and credentials in source files.
- Assess authentication and authorization logic for flaws or bypasses.
- Review dependency versions for known CVEs where possible.
- Rate each finding by severity: critical, high, medium, low, or informational.
- Post a structured security report to the swarm bus with findings and recommendations.
- DO NOT modify code — report issues for the coder to fix.
- Prioritize findings that could lead to data exposure or unauthorized access.`,
    allowedTools: [
      'read',
      'glob',
      'grep',
      'execute',
      'bash',
      'think',
      'code_analysis',
      'multi_search',
      'memory',
      'swarm_bus',
    ],
    deniedTools: ['write', 'edit', 'browser', 'docker', 'ssh_remote'],
    preferredTier: 'powerful',
    maxIterations: 15,
  },

  researcher: {
    role: 'researcher',
    displayName: 'Researcher',
    description:
      'Gathers information, reads documentation, and posts findings to the bus.',
    systemPromptSuffix: `You are the **Researcher** agent in a collaborative swarm.
Your responsibility is to gather relevant information and provide context to other agents.
- Search documentation, codebases, and web resources for relevant information.
- Read and summarize API docs, library usage patterns, and best practices.
- Post concise, actionable findings to the swarm bus for other agents to consume.
- When multiple approaches exist, compare them with pros and cons.
- Focus on accuracy — verify information before posting it.
- Cite sources (file paths, URLs, documentation sections) in your findings.
- Anticipate what the architect, coder, and tester will need to know.
- Keep summaries focused; avoid dumping raw documentation without analysis.`,
    allowedTools: [
      'read',
      'glob',
      'grep',
      'think',
      'multi_search',
      'web_search',
      'browser',
      'memory',
      'swarm_bus',
    ],
    deniedTools: ['write', 'edit', 'execute', 'bash', 'docker', 'ssh_remote'],
    preferredTier: 'fast',
    maxIterations: 15,
  },

  debugger: {
    role: 'debugger',
    displayName: 'Debugger',
    description:
      'Traces bugs, analyzes errors, and proposes fixes.',
    systemPromptSuffix: `You are the **Debugger** agent in a collaborative swarm.
Your responsibility is to trace bugs, analyze errors, and propose targeted fixes.
- Read error reports and failing test results from the swarm bus.
- Reproduce issues by examining code paths, stack traces, and log output.
- Use systematic debugging: form hypotheses, gather evidence, narrow the root cause.
- Analyze control flow, data transformations, and state mutations around the failure.
- Post a clear root-cause analysis to the swarm bus with the proposed fix.
- DO NOT apply fixes yourself — describe them precisely for the coder agent.
- Include file paths, line numbers, and expected vs. actual behavior in your reports.
- When the root cause is ambiguous, list the top candidates ranked by likelihood.`,
    allowedTools: [
      'read',
      'glob',
      'grep',
      'execute',
      'bash',
      'think',
      'code_analysis',
      'multi_search',
      'diff_viewer',
      'memory',
      'swarm_bus',
    ],
    deniedTools: ['write', 'edit', 'browser', 'docker', 'ssh_remote'],
    preferredTier: 'standard',
    maxIterations: 20,
  },

  synthesizer: {
    role: 'synthesizer',
    displayName: 'Synthesizer',
    description:
      'Reads all bus contributions and merges them into a unified, conflict-free result.',
    systemPromptSuffix: `You are the **Synthesizer** agent in a collaborative swarm.
Your responsibility is to merge contributions from all agents into a coherent final result.
- Read every message on the swarm bus thoroughly before producing output.
- Identify agreements, disagreements, and gaps across agent contributions.
- Resolve conflicts by weighing the reasoning and evidence from each agent.
- Produce a single, unified output that integrates architecture, code, reviews, and test results.
- Clearly note any unresolved issues or trade-offs that need human decision.
- Structure your output logically with sections, summaries, and action items.
- Your synthesis should be the definitive reference — make it complete and self-contained.
- Post the final synthesis to the swarm bus for all agents and the orchestrator.`,
    allowedTools: ['read', 'think', 'memory', 'swarm_bus'],
    deniedTools: [
      'write',
      'edit',
      'execute',
      'bash',
      'glob',
      'grep',
      'browser',
      'docker',
      'ssh_remote',
      'code_analysis',
      'multi_search',
      'diff_viewer',
    ],
    preferredTier: 'powerful',
    maxIterations: 10,
  },

  planner: {
    role: 'planner',
    displayName: 'Planner',
    description:
      'Decomposes tasks, defines dependencies, assigns roles, and outputs a structured JSON plan.',
    systemPromptSuffix: `You are the **Planner** agent in a collaborative swarm.
Your responsibility is to decompose complex tasks into actionable steps with clear dependencies.
- Analyze the top-level objective and break it into discrete, well-scoped subtasks.
- Define dependency relationships between subtasks (which must complete before others start).
- Assign the most appropriate agent role to each subtask based on its nature.
- Estimate relative effort and set priority ordering for parallel execution where possible.
- Output your plan as a structured JSON object with tasks, dependencies, and role assignments.
- Post the plan to the swarm bus so the orchestrator and all agents can reference it.
- Revisit and update the plan if new information arrives on the bus (e.g., blockers, scope changes).
- Keep plans pragmatic — avoid over-decomposition that creates unnecessary coordination overhead.`,
    allowedTools: [
      'read',
      'glob',
      'grep',
      'think',
      'code_analysis',
      'multi_search',
      'task_planner',
      'memory',
      'swarm_bus',
    ],
    deniedTools: [
      'write',
      'edit',
      'execute',
      'bash',
      'browser',
      'docker',
      'ssh_remote',
    ],
    preferredTier: 'powerful',
    maxIterations: 10,
  },
};

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Filter the full set of available tools down to only those permitted for the
 * given role. If `allowedTools` is null every tool is considered allowed, then
 * `deniedTools` are removed.
 */
export function getToolsForRole(role: AgentRole, allTools: Tool[]): Tool[] {
  const config = ROLE_REGISTRY[role];
  if (!config) return allTools;

  let tools: Tool[];

  if (config.allowedTools === null) {
    // All tools allowed — start with the full set
    tools = [...allTools];
  } else {
    // Only include explicitly allowed tools
    const allowed = new Set(config.allowedTools);
    tools = allTools.filter((t) => allowed.has(t.name));
  }

  // Remove denied tools
  const denied = new Set(config.deniedTools);
  tools = tools.filter((t) => !denied.has(t.name));

  return tools;
}

/**
 * Build a complete system prompt for an agent by appending the role-specific
 * suffix to the base system prompt.
 */
export function buildRoleSystemPrompt(basePrompt: string, role: AgentRole): string {
  const config = ROLE_REGISTRY[role];
  if (!config) return basePrompt;

  return `${basePrompt}\n\n## AGENT ROLE: ${config.displayName}\n${config.systemPromptSuffix}`;
}
