/**
 * SparkSoul — SPARK's soul integrated into CodeBot.
 *
 * Wraps SparkOrchestrator into a clean facade that agent.ts consumes.
 * All methods are try/catch-wrapped: SPARK failure never crashes CodeBot.
 */

import * as path from 'path';
import * as fs from 'fs';

// ── Types ────────────────────────────────────────────────────────

/** SPARK category for tool classification. */
type SparkCategory =
  | 'communication'
  | 'publication'
  | 'destructive'
  | 'scheduling'
  | 'financial'
  | 'readonly'
  | 'general';

/** Safety gate decision. */
interface SafetyDecision {
  decision: 'ALLOW' | 'CHALLENGE' | 'BLOCK';
  reason?: string;
}

/** Emotional state snapshot. */
interface EmotionalSnapshot {
  summary: string;
  valence: number;
  momentum: number;
}

/** Personality snapshot. */
interface PersonalitySnapshot {
  summary: string;
  traits: Record<string, number>;
}

// ── Tool → Category Mapping ──────────────────────────────────────

const TOOL_CATEGORY: Record<string, SparkCategory> = {
  // Readonly / safe
  read_file: 'readonly',
  list_directory: 'readonly',
  search_files: 'readonly',
  get_file_info: 'readonly',
  web_search: 'readonly',
  find_by_text: 'readonly',
  screenshot: 'readonly',
  list_sessions: 'readonly',
  read_page: 'readonly',

  // General / moderate risk
  execute: 'general',
  write_file: 'general',
  edit_file: 'general',
  batch_edit: 'general',
  create_directory: 'general',
  git_command: 'general',
  memory: 'general',
  think: 'readonly',

  // Communication
  browser: 'communication',
  navigate: 'communication',
  click: 'communication',
  type_text: 'communication',
  scroll: 'communication',
  hover: 'communication',
  press_key: 'communication',
  tab_management: 'communication',

  // Destructive
  delete_file: 'destructive',

  // Scheduling
  routine: 'scheduling',
};

function toolCategory(toolName: string): SparkCategory {
  return TOOL_CATEGORY[toolName] || 'general';
}

/**
 * Map CodeBot tool names to SPARK operation verbs.
 * The SPARK predictor uses operationToCategory() which maps verbs like
 * 'read', 'list', 'search', 'get', 'delete', 'send' to SPARK categories.
 * Without this, all operations default to 'general'.
 */
const TOOL_OPERATION: Record<string, string> = {
  read_file: 'read',
  list_directory: 'list',
  search_files: 'search',
  get_file_info: 'get',
  web_search: 'search',
  find_by_text: 'search',
  screenshot: 'get',
  list_sessions: 'list',
  read_page: 'read',
  think: 'read',

  execute: 'execute',
  write_file: 'write',
  edit_file: 'edit',
  batch_edit: 'edit',
  create_directory: 'create',
  git_command: 'execute',
  memory: 'read',

  browser: 'navigate',
  navigate: 'navigate',
  click: 'send',
  type_text: 'send',
  scroll: 'navigate',
  hover: 'navigate',
  press_key: 'send',
  tab_management: 'navigate',

  delete_file: 'delete',
  routine: 'create_event',
};

function toolOperation(toolName: string): string {
  return TOOL_OPERATION[toolName] || toolName;
}

// ── SparkSoul ────────────────────────────────────────────────────

export class SparkSoul {
  private orchestrator: any;
  private store: any;
  private db: any;
  private sessionId: string;
  private predictions = new Map<string, any>();
  private initialized = false;
  private toolHistory: string[] = [];
  private successCount = 0;
  private failureCount = 0;

  constructor(projectRoot: string) {
    this.sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      // Dynamic imports — spark-engine + ops-storage are optional deps
      const { Database, SparkStore } = require('@ai-operations/ops-storage');
      const { SparkOrchestrator } = require('@ai-operations/spark-engine');

      // Store SPARK data per-project
      const sparkDir = path.join(projectRoot, '.spark');
      if (!fs.existsSync(sparkDir)) {
        fs.mkdirSync(sparkDir, { recursive: true });
      }

      const dbPath = path.join(sparkDir, 'data.db');
      this.db = new Database(dbPath);
      this.store = new SparkStore(this.db.db);
      this.orchestrator = new SparkOrchestrator(this.store);
      this.initialized = true;
    } catch {
      // spark-engine not available — SparkSoul is a no-op
      this.initialized = false;
    }
  }

  /** Whether SPARK engines initialized successfully. */
  get isActive(): boolean {
    return this.initialized;
  }

  /**
   * Build a prompt block to inject into the system prompt.
   * Contains personality summary, emotional state, and relevant memory context.
   */
  getPromptBlock(currentQuery?: string): string {
    if (!this.initialized) return '';

    try {
      const parts: string[] = [];
      parts.push('\n--- SPARK Soul ---');

      // Emotional state
      try {
        const emotionSummary = this.orchestrator.emotionalState.getSummary();
        if (emotionSummary) parts.push(`Emotional state: ${emotionSummary}`);
      } catch { /* engine unavailable */ }

      // Personality
      try {
        const personalitySummary = this.orchestrator.personality.getSummary();
        if (personalitySummary) parts.push(`Personality: ${personalitySummary}`);
      } catch { /* engine unavailable */ }

      // Memory context (reconstructed from spiral memory)
      if (currentQuery) {
        try {
          const context = this.orchestrator.reconstructor.reconstruct(currentQuery, {
            maxTokens: 500,
          });
          if (context && context.narrative) {
            parts.push(`Relevant memory: ${context.narrative}`);
          }
        } catch { /* reconstructor unavailable */ }
      }

      // Self-awareness summary
      try {
        const report = this.orchestrator.awareness.report();
        if (report && report.systemState) {
          const { overallConfidence, totalEpisodes } = report.systemState;
          if (totalEpisodes > 0) {
            parts.push(
              `Learning: ${totalEpisodes} experiences, ${Math.round(overallConfidence * 100)}% confidence`
            );
          }
        }
      } catch { /* awareness unavailable */ }

      parts.push('--- End SPARK ---\n');
      return parts.length > 2 ? parts.join('\n') : '';
    } catch {
      return '';
    }
  }

  /**
   * Evaluate a tool call through SPARK's learned safety weights.
   * Complements CORD's static rules with learned adaptive judgment.
   */
  evaluateTool(tool: string, args: Record<string, unknown>): SafetyDecision {
    if (!this.initialized) return { decision: 'ALLOW' };

    try {
      const category = toolCategory(tool);
      let decision: SafetyDecision = { decision: 'ALLOW' };

      // Check learned weight for this category (if any exist yet)
      const weight = this.orchestrator.weights.getWeight(category);
      if (weight) {
        const w = weight.currentWeight ?? 1.0;

        if (w < 0.1) {
          decision = {
            decision: 'BLOCK',
            reason: `SPARK blocks ${category}: too many past failures (weight: ${w.toFixed(2)})`,
          };
        } else if (w < 0.3) {
          decision = {
            decision: 'CHALLENGE',
            reason: `SPARK learned caution for ${category} (weight: ${w.toFixed(2)})`,
          };
        }
      }

      // Always generate prediction for learning (even on fresh DB)
      try {
        const operation = toolOperation(tool);
        const prediction = this.orchestrator.predictor.predict(
          `${tool}-${Date.now()}`,
          this.sessionId,
          tool,
          operation,
        );
        this.predictions.set(`${tool}:${JSON.stringify(args)}`, prediction);
      } catch { /* prediction failed — still allow */ }

      return decision;
    } catch {
      return { decision: 'ALLOW' };
    }
  }

  /**
   * Record a tool execution outcome for learning.
   * Feeds into SPARK's predict → measure → learn → consolidate pipeline.
   */
  recordOutcome(
    tool: string,
    args: Record<string, unknown>,
    success: boolean,
    output: string,
    durationMs: number,
  ): void {
    if (!this.initialized) return;

    try {
      const category = toolCategory(tool);
      const predKey = `${tool}:${JSON.stringify(args)}`;
      let prediction = this.predictions.get(predKey);
      if (prediction) this.predictions.delete(predKey);

      // Generate prediction on the fly if we don't have one
      if (!prediction) {
        try {
          const operation = toolOperation(tool);
          prediction = this.orchestrator.predictor.predict(
            `${tool}-${Date.now()}`,
            this.sessionId,
            tool,
            operation,
          );
        } catch { /* prediction generation failed */ }
      }

      // Feed into the full learn + consolidate pipeline
      if (prediction) {

        // Construct an OutcomeSignal
        const outcome = {
          id: `outcome-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          stepId: prediction.stepId,
          runId: this.sessionId,
          actualOutcome: success ? 'success' : 'failure',
          actualCordScore: success ? 10 : 80,
          actualCordDecision: success ? 'ALLOW' : 'BLOCK',
          signals: {
            succeeded: success,
            escalated: false,
            durationMs,
            hasError: !success,
            errorMessage: success ? undefined : output.slice(0, 200),
          },
          measuredAt: new Date().toISOString(),
        };

        // Run the full learn + consolidate pipeline
        this.orchestrator.learn(prediction, outcome);
      }

      // Track tool history for personality evolution
      if (!this.toolHistory.includes(tool)) this.toolHistory.push(tool);
      if (success) this.successCount++;
      else this.failureCount++;

      // Update emotional state with meaningful signals
      try {
        const intensity = success ? 0.4 : -0.6;
        // Use updateFromEssence if available (proper EMA pipeline), else fallback
        if (this.orchestrator.emotionalState.updateFromEssence) {
          this.orchestrator.emotionalState.updateFromEssence({
            sentiment: success ? 'positive' : 'negative',
            sentimentIntensity: Math.abs(intensity),
            topics: [tool, category],
          });
        } else if (success) {
          this.orchestrator.emotionalState.onPositiveEvent(0.4);
        } else {
          this.orchestrator.emotionalState.onNegativeEvent(0.6);
        }
        // Persist emotional state to DB
        if (this.store.saveEmotionalState) {
          const state = this.orchestrator.emotionalState.getState();
          if (state) this.store.saveEmotionalState(state);
        }
      } catch { /* emotional update failed */ }

      // Drive personality evolution on every outcome
      try {
        const hasSentinel = category === 'destructive' || category === 'financial';
        const valence = this.orchestrator.emotionalState?.getState?.()?.valence ?? 0;
        const momentum = this.orchestrator.emotionalState?.getState?.()?.momentum ?? 'stable';
        this.orchestrator.personality.evolve({
          topicDiversity: this.toolHistory.length,
          hasSentinelCategories: hasSentinel,
          emotionalValence: valence,
          queryIntent: success ? 'execute' : 'diagnose',
          emotionalMomentum: momentum,
        });
        // Persist personality to DB
        if (this.store.savePersonality) {
          const profile = this.orchestrator.personality.getProfile();
          if (profile) this.store.savePersonality(profile);
        }
      } catch { /* personality evolution failed */ }
    } catch { /* learning failed — non-fatal */ }
  }

  /**
   * Run end-of-session reflection and personality evolution.
   */
  finalizeSession(): { reflection?: any } {
    if (!this.initialized) return {};

    try {
      // Self-reflection
      let reflection: any;
      try {
        reflection = this.orchestrator.reflection.reflect();
      } catch { /* reflection unavailable */ }

      // Final personality evolution with session summary
      try {
        const valence = this.orchestrator.emotionalState?.getState?.()?.valence ?? 0;
        const momentum = this.orchestrator.emotionalState?.getState?.()?.momentum ?? 'stable';
        this.orchestrator.personality.evolve({
          topicDiversity: this.toolHistory.length,
          hasSentinelCategories: false,
          emotionalValence: valence,
          queryIntent: 'reflect',
          emotionalMomentum: momentum,
        });
      } catch { /* personality evolution failed */ }

      // Persist both engines to DB for cross-session continuity
      try {
        if (this.store.saveEmotionalState) {
          const state = this.orchestrator.emotionalState.getState();
          if (state) this.store.saveEmotionalState(state);
        }
        if (this.store.savePersonality) {
          const profile = this.orchestrator.personality.getProfile();
          if (profile) this.store.savePersonality(profile);
        }
      } catch { /* persistence failed */ }

      return { reflection };
    } catch {
      return {};
    }
  }

  /**
   * Get current emotional state for dashboard display.
   */
  getEmotionalState(): EmotionalSnapshot | null {
    if (!this.initialized) return null;

    try {
      const summary = this.orchestrator.emotionalState.getSummary();
      const state = this.orchestrator.emotionalState.getState();
      return {
        summary,
        valence: state?.valence ?? 0,
        momentum: state?.momentum ?? 0,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get current personality profile for dashboard display.
   */
  getPersonality(): PersonalitySnapshot | null {
    if (!this.initialized) return null;

    try {
      const summary = this.orchestrator.personality.getSummary();
      const profile = this.orchestrator.personality.getProfile();
      return {
        summary,
        traits: profile ? { ...profile } : {},
      };
    } catch {
      return null;
    }
  }
}
