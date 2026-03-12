/**
 * SPARK Helper Functions
 *
 * Pure, exported functions for classification, resolution, and outcome building.
 * No class dependencies — these are testable in isolation.
 */

import {
  FailureType,
  FailureOutcome,
  SafetyDecision,
  SparkCategory,
  TOOL_CATEGORY,
  TOOL_OPERATION,
} from './spark-types';

// ── Score & Classification ───────────────────────────────────────

/** Map a CORD score to a decision. */
export function scoreToDecision(score: number): string {
  if (score < 20) return 'ALLOW';
  if (score < 75) return 'CHALLENGE';
  return 'BLOCK';
}

/** Classify an error message into a failure type. */
export function classifyFailure(errorMsg: string): FailureType {
  const lower = errorMsg.toLowerCase();
  if (/blocked|denied|forbidden|unauthorized|constitutional|security/.test(lower)) return 'security_block';
  if (/not found|enoent|invalid|missing|does not exist|no such|bad request/.test(lower)) return 'input_error';
  return 'runtime_error';
}

/** Map a failure type to an outcome descriptor with intensity. */
export function failureToOutcome(failureType: FailureType): FailureOutcome {
  switch (failureType) {
    case 'security_block': return { outcome: 'blocked', intensity: 0.8 };
    case 'input_error': return { outcome: 'partial', intensity: 0.2 };
    default: return { outcome: 'failure', intensity: 0.6 };
  }
}

// ── Execute Command Classifiers ──────────────────────────────────

const DESTRUCTIVE_CMD = /\b(rm|rmdir|kill|pkill|killall)\b/;
const COMMUNICATION_CMD = /\b(curl|wget|fetch)\b/;
const READONLY_CMD = /\b(ls|cat|head|tail|wc|du|df|file|stat|find|grep)\b/;

function classifyExecuteCategory(cmd: string): SparkCategory {
  if (DESTRUCTIVE_CMD.test(cmd)) return 'destructive';
  if (COMMUNICATION_CMD.test(cmd)) return 'communication';
  if (READONLY_CMD.test(cmd)) return 'readonly';
  return 'general';
}

function classifyExecuteOperation(cmd: string): string {
  if (/\b(rm|rmdir)\b/.test(cmd)) return 'delete';
  if (COMMUNICATION_CMD.test(cmd)) return 'send';
  if (READONLY_CMD.test(cmd)) return 'read';
  return 'execute';
}

// ── Git Subcommand Classifiers ───────────────────────────────────

function classifyGitCategory(sub: string): SparkCategory {
  if (/^push\b/.test(sub)) return 'publication';
  if (/reset\s+--hard|force\s+push/.test(sub)) return 'destructive';
  if (/^(status|diff|log|show|branch)\b/.test(sub)) return 'readonly';
  return 'general';
}

function classifyGitOperation(sub: string): string {
  if (/^push\b/.test(sub)) return 'publish';
  if (/^(status|diff|log|show)\b/.test(sub)) return 'read';
  if (/^commit\b/.test(sub)) return 'write';
  if (/^reset\b/.test(sub)) return 'delete';
  return 'execute';
}

// ── Dynamic Resolution ───────────────────────────────────────────

/** Dynamically resolve the SPARK category for a tool call. */
export function resolveToolCategory(tool: string, args?: Record<string, unknown>): SparkCategory {
  const a = args || {};
  if (tool === 'execute' && a.command) return classifyExecuteCategory(String(a.command));
  if ((tool === 'git' || tool === 'git_command') && a.subcommand) return classifyGitCategory(String(a.subcommand));
  return TOOL_CATEGORY[tool] || 'general';
}

/** Dynamically resolve the SPARK operation verb for a tool call. */
export function resolveToolOperation(tool: string, args?: Record<string, unknown>): string {
  const a = args || {};
  if (tool === 'execute' && a.command) return classifyExecuteOperation(String(a.command));
  if ((tool === 'git' || tool === 'git_command') && a.subcommand) return classifyGitOperation(String(a.subcommand));
  return TOOL_OPERATION[tool] || tool;
}

// ── Outcome Building ─────────────────────────────────────────────

/** Safely call a function, returning undefined on error. */
export function tryCall<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

/** Build an OutcomeSignal for the SPARK learning pipeline. */
export function buildOutcomeSignal(
  prediction: any,
  sessionId: string,
  success: boolean,
  output: string,
  durationMs: number,
  failureInfo?: FailureOutcome,
): any {
  const cordScore = prediction.predictedScore ?? 10;
  return {
    id: `outcome-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    stepId: prediction.stepId,
    runId: sessionId,
    actualOutcome: success ? 'success' : (failureInfo ? failureInfo.outcome : 'failure'),
    actualCordScore: cordScore,
    actualCordDecision: scoreToDecision(cordScore),
    signals: {
      succeeded: success,
      escalated: false,
      approvalGranted: true,
      durationMs,
      hasError: !success,
      errorMessage: success ? undefined : output.slice(0, 200),
      failureType: failureInfo ? classifyFailure(output) : undefined,
      intensity: failureInfo ? failureInfo.intensity : undefined,
    },
    measuredAt: new Date().toISOString(),
  };
}

/** Compute a safety decision from a prediction and learned weights. */
export function makeSafetyDecision(prediction: any, orchestrator: any, category: string): SafetyDecision {
  if (!prediction) return { decision: 'ALLOW' };
  const w = orchestrator.weights.getMultiplier(category);
  if (w <= 1.05) return { decision: 'ALLOW' };
  const adjustedScore = prediction.predictedScore ?? 0;
  const sparkDecision = scoreToDecision(adjustedScore);
  if (sparkDecision === 'BLOCK') {
    return { decision: 'BLOCK', reason: `SPARK blocks ${category}: learned risk score ${adjustedScore} (weight: ${w.toFixed(2)})` };
  }
  if (sparkDecision === 'CHALLENGE') {
    return { decision: 'CHALLENGE', reason: `SPARK learned caution for ${category}: risk score ${adjustedScore} (weight: ${w.toFixed(2)})` };
  }
  return { decision: 'ALLOW' };
}

// ── Orchestrator Helpers ─────────────────────────────────────────

/** Update emotional state from a tool outcome. */
export function updateEmotionalState(
  orchestrator: any,
  store: any,
  success: boolean,
  failureInfo: FailureOutcome | undefined,
  tool: string,
  category: string,
): void {
  const intensity = success ? 0.4 : -(failureInfo ? failureInfo.intensity : 0.6);
  if (orchestrator.emotionalState.updateFromEssence) {
    orchestrator.emotionalState.updateFromEssence({
      sentiment: success ? 'positive' : 'negative',
      sentimentIntensity: Math.abs(intensity),
      topics: [tool, category],
    });
  } else if (success) {
    orchestrator.emotionalState.onPositiveEvent(0.4);
  } else {
    orchestrator.emotionalState.onNegativeEvent(failureInfo ? failureInfo.intensity : 0.6);
  }
  if (store.saveEmotionalState) {
    const state = orchestrator.emotionalState.getState();
    if (state) store.saveEmotionalState(state);
  }
}

/** Drive personality evolution with current context. */
export function evolvePersonality(
  orchestrator: any,
  store: any,
  toolHistory: string[],
  hasSentinel: boolean,
  queryIntent: string,
): void {
  const valence = orchestrator.emotionalState?.getState?.()?.valence ?? 0;
  const momentum = orchestrator.emotionalState?.getState?.()?.momentum ?? 'stable';
  orchestrator.personality.evolve({
    topicDiversity: toolHistory.length,
    hasSentinelCategories: hasSentinel,
    emotionalValence: valence,
    queryIntent,
    emotionalMomentum: momentum,
  });
  if (store.savePersonality) {
    const profile = orchestrator.personality.getProfile();
    if (profile) store.savePersonality(profile);
  }
}

/** Persist emotional state and personality to DB. */
export function persistEngines(orchestrator: any, store: any): void {
  if (store.saveEmotionalState) {
    const state = orchestrator.emotionalState.getState();
    if (state) store.saveEmotionalState(state);
  }
  if (store.savePersonality) {
    const profile = orchestrator.personality.getProfile();
    if (profile) store.savePersonality(profile);
  }
}

/** Initialize weight bounds for all categories. */
export function initializeWeightBounds(store: any, wideBounds: Record<string, { lower: number; upper: number }>): void {
  for (const [cat, bounds] of Object.entries(wideBounds)) {
    const existing = store.getWeight(cat);
    if (existing && (existing.lowerBound !== bounds.lower || existing.upperBound !== bounds.upper)) {
      store.saveWeight({ ...existing, lowerBound: bounds.lower, upperBound: bounds.upper });
    }
  }
}

/** Seed initial weights for categories that don't have entries yet. */
export function seedCategoryWeights(
  store: any,
  baseScores: Record<string, number>,
  wideBounds: Record<string, { lower: number; upper: number }>,
): void {
  for (const cat of Object.keys(baseScores)) {
    const existing = store.getWeight(cat);
    if (existing) continue;
    const bounds = wideBounds[cat] || { lower: 0.7, upper: 1.3 };
    store.saveWeight({
      category: cat, currentWeight: 1.0, baseWeight: 1.0,
      lowerBound: bounds.lower, upperBound: bounds.upper,
      episodeCount: 0, lastAdjustedAt: new Date().toISOString(),
    });
  }
}
