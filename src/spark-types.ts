/**
 * SPARK Type Definitions
 *
 * Shared types, constants, and mappings used by spark-helpers and spark-soul.
 */

// ── Types ────────────────────────────────────────────────────────

/** SPARK category for tool classification. */
export type SparkCategory =
  | 'communication'
  | 'publication'
  | 'destructive'
  | 'scheduling'
  | 'financial'
  | 'readonly'
  | 'general';

/** Failure classification for nuanced learning. */
export type FailureType = 'security_block' | 'input_error' | 'runtime_error';

/** Safety gate decision. */
export interface SafetyDecision {
  decision: 'ALLOW' | 'CHALLENGE' | 'BLOCK';
  reason?: string;
}

/** Emotional state snapshot. */
export interface EmotionalSnapshot {
  summary: string;
  valence: number;
  momentum: number;
}

/** Personality snapshot. */
export interface PersonalitySnapshot {
  summary: string;
  traits: Record<string, number>;
}

/** Failure outcome with intensity. */
export interface FailureOutcome {
  outcome: string;
  intensity: number;
}

// ── Constants ────────────────────────────────────────────────────

/** Static tool → category mapping. */
export const TOOL_CATEGORY: Record<string, SparkCategory> = {
  read_file: 'readonly', list_directory: 'readonly', search_files: 'readonly',
  get_file_info: 'readonly', web_search: 'readonly', find_by_text: 'readonly',
  screenshot: 'readonly', list_sessions: 'readonly', read_page: 'readonly',
  grep: 'readonly', glob: 'readonly', diff_viewer: 'readonly', think: 'readonly',
  execute: 'general', write_file: 'general', edit_file: 'general',
  batch_edit: 'general', create_directory: 'general', git: 'general',
  git_command: 'general', memory: 'general',
  browser: 'communication', navigate: 'communication', click: 'communication',
  type_text: 'communication', scroll: 'communication', hover: 'communication',
  press_key: 'communication', tab_management: 'communication', web_fetch: 'communication',
  delete_file: 'destructive',
  routine: 'scheduling',
  publish: 'publication', deploy: 'publication',
};

/** Static tool → operation verb mapping. */
export const TOOL_OPERATION: Record<string, string> = {
  read_file: 'read', list_directory: 'list', search_files: 'search',
  get_file_info: 'get', web_search: 'search', find_by_text: 'search',
  screenshot: 'get', list_sessions: 'list', read_page: 'read', think: 'read',
  grep: 'search', glob: 'search', diff_viewer: 'read',
  execute: 'execute', write_file: 'write', edit_file: 'edit',
  batch_edit: 'edit', create_directory: 'create', git: 'execute',
  git_command: 'execute', memory: 'read',
  browser: 'navigate', navigate: 'navigate', click: 'send',
  type_text: 'send', scroll: 'navigate', hover: 'navigate',
  press_key: 'send', tab_management: 'navigate', web_fetch: 'send',
  delete_file: 'delete', routine: 'create_event',
  publish: 'publish', deploy: 'publish',
};

/** Base CORD scores per category. */
export const CATEGORY_BASE_SCORES: Record<string, number> = {
  readonly: 5, scheduling: 25, general: 30, communication: 35,
  publication: 50, destructive: 70, financial: 75,
};

/** Weight bounds per category for CodeBot's wider learning range. */
export const WIDE_BOUNDS: Record<string, { lower: number; upper: number }> = {
  readonly: { lower: 0.3, upper: 5.0 },
  general: { lower: 0.3, upper: 3.0 },
  communication: { lower: 0.5, upper: 2.5 },
  scheduling: { lower: 0.5, upper: 3.0 },
  publication: { lower: 0.7, upper: 2.0 },
  destructive: { lower: 0.7, upper: 1.5 },
  financial: { lower: 0.8, upper: 1.3 },
};

export const ALL_CATEGORIES = ['readonly', 'general', 'communication', 'scheduling', 'publication', 'destructive', 'financial'] as const;
