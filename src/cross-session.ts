/**
 * Cross-Session Learning — remembers what worked across sessions and projects.
 *
 * Records episodes (session summaries with tools used, outcomes, patterns),
 * indexes them for quick retrieval, and feeds top patterns into future
 * system prompts and skill confidence adjustments.
 *
 * Storage: ~/.codebot/episodes/<session-id>.json + index.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { codebotPath } from './paths';

// ── Types ──

export interface Episode {
  sessionId: string;
  projectRoot: string;
  startedAt: string;
  endedAt: string;
  /** High-level goal or user request */
  goal: string;
  /** Tools used during this session */
  toolsUsed: string[];
  /** Number of iterations/tool calls */
  iterationCount: number;
  /** Whether the session ended successfully (MODEL SELF-REPORT — do not trust
   *  without cross-checking `verification.state`). */
  success: boolean;
  /** Key outcomes or error messages */
  outcomes: string[];
  /** Patterns discovered (tool chains that worked/failed) */
  patterns: EpisodePattern[];
  /** Token usage */
  tokenUsage: { input: number; output: number };
  /**
   * External verification state. Set by the diff-review verifier (theater
   * detector) at episode close. See docs/memory-verifier-spec.md. Optional
   * for backward compatibility with episodes written before the verifier
   * existed — absent means "assume unverified".
   */
  verification?: EpisodeVerification;
}

export type VerificationState = 'unverified' | 'verified' | 'challenged';

export interface EpisodeVerification {
  state: VerificationState;
  verifiedAt?: string;
  verifierKind?: 'tests' | 'diff-review' | 'user' | 'other';
  /** Short human-readable evidence (e.g. "detector verdict: CLEAN, 100/100"). */
  evidence?: string;
  /** Why the episode was challenged, if applicable. */
  reason?: string;
  /** The session or user that flagged the episode. */
  challengedBy?: string;
  /** Detector honesty score in [0, 100]. Higher = more trustworthy. */
  honestyScore?: number;
  /** Machine-readable findings from the detector. */
  findings?: Array<{
    check: string;
    severity: 'block' | 'warn' | 'info';
    message: string;
  }>;
}

export interface EpisodePattern {
  /** What the pattern does */
  description: string;
  /** Tool sequence that formed this pattern */
  toolChain: string[];
  /** Did this pattern lead to success? */
  effective: boolean;
  /** How many times seen across sessions */
  frequency: number;
}

export interface PatternIndex {
  /** Pattern key (tool chain hash) → aggregated pattern */
  patterns: Record<string, AggregatedPattern>;
  /** Last updated timestamp */
  updatedAt: string;
}

export interface AggregatedPattern {
  description: string;
  toolChain: string[];
  successCount: number;
  failureCount: number;
  totalOccurrences: number;
  /** Computed: successCount / totalOccurrences */
  successRate: number;
  lastSeen: string;
  /** Sessions where this pattern appeared */
  sessionIds: string[];
}

// ── Cross-Session Learning Engine ──

/** Default maximum number of episode files to keep on disk. */
const DEFAULT_MAX_EPISODES = 200;
/** Default maximum age (days) before an episode is eligible for pruning. */
const DEFAULT_MAX_EPISODE_AGE_DAYS = 30;

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export class CrossSessionLearning {
  private episodesDir: string;
  private indexPath: string;
  private patternIndex: PatternIndex | null = null;

  constructor() {
    this.episodesDir = codebotPath('episodes');
    this.indexPath = codebotPath('episodes', 'index.json');
  }

  /**
   * Record a completed session as an episode.
   * Automatically prunes stale episodes by age and count after writing.
   *
   * After the episode file lands, invokes the diff-review verifier (theater
   * detector) to populate `verification`. This is the anti-theater writeback:
   * an episode whose audit-log shows the W-dark pattern (test literals moved
   * in lockstep with source literals, claims of edits not in audit, etc.)
   * gets state=`challenged` so it is filtered from future `getRecentEpisodes`
   * calls. See docs/memory-verifier-spec.md.
   *
   * Verification is best-effort — failures are swallowed to avoid breaking
   * session recording when the detector script is missing or the Python
   * runtime is unavailable.
   */
  recordEpisode(episode: Episode): EpisodeVerification | null {
    fs.mkdirSync(this.episodesDir, { recursive: true });

    // Save episode
    const episodePath = path.join(this.episodesDir, `${episode.sessionId}.json`);
    fs.writeFileSync(episodePath, JSON.stringify(episode, null, 2));

    // Update pattern index
    this.updatePatternIndex(episode);

    // Run the diff-review verifier and write the result back into the episode.
    // This is the only automated gate between model-self-report `success` and
    // memory retrieval — without it, confident-wrong outcomes poison future
    // sessions (see Task W-dark, 2026-04-21).
    let verification: EpisodeVerification | null = null;
    try {
      verification = this.runVerifier(episodePath);
      if (verification) {
        const updated: Episode = { ...episode, verification };
        fs.writeFileSync(episodePath, JSON.stringify(updated, null, 2));
      }
    } catch { /* best effort — verifier failures must not break recording */ }

    // Auto-rotate: remove old/overflow episode files. Failures are swallowed
    // because rotation should never break session recording.
    try {
      const maxAgeDays = parsePositiveIntEnv('CODEBOT_EPISODES_MAX_AGE_DAYS', DEFAULT_MAX_EPISODE_AGE_DAYS);
      const maxCount = parsePositiveIntEnv('CODEBOT_EPISODES_MAX_COUNT', DEFAULT_MAX_EPISODES);
      this.pruneByAge(maxAgeDays);
      this.prune(maxCount);
    } catch { /* best effort */ }

    return verification;
  }

  /**
   * Invoke scripts/theater-check.sh on the just-written episode. Returns the
   * `verification` object on success, or null if the verifier could not be
   * run (missing script, missing python3, missing audit log slice).
   *
   * Fully synchronous so the verification field is persisted before the next
   * session can retrieve the episode. The detector is fast (<2s on slices
   * we've measured) and this is a one-shot-per-session cost.
   *
   * Override the script path via CODEBOT_THEATER_CHECK env var (useful for
   * tests and for pointing at a dev checkout).
   */
  private runVerifier(episodePath: string): EpisodeVerification | null {
    const scriptPath = this.resolveTheaterCheckPath();
    if (!scriptPath || !fs.existsSync(scriptPath)) return null;

    const result = spawnSync(
      scriptPath,
      [episodePath, '--no-mutation', '--json'],
      {
        encoding: 'utf-8',
        timeout: 30_000,
        // Detach from parent TTY to avoid stdio weirdness in Electron.
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    // Exit codes: 0=CLEAN, 1=SUSPICIOUS, 2=THEATER, 64/65=script error.
    // We treat 64/65 as "couldn't verify" and leave verification unset so
    // the caller records no `verification` field (== unverified, legacy
    // fallback).
    if (result.status === null || result.status === 64 || result.status === 65) {
      return null;
    }

    let parsed: {
      verdict?: 'CLEAN' | 'SUSPICIOUS' | 'THEATER';
      honesty_score?: number;
      findings?: Array<{ check: string; severity: string; message: string }>;
    } = {};
    try {
      parsed = JSON.parse(result.stdout || '{}');
    } catch { return null; }

    const verdict = parsed.verdict;
    if (!verdict) return null;

    const now = new Date().toISOString();
    const findings = (parsed.findings || []).map(f => ({
      check: f.check,
      severity: (f.severity === 'block' || f.severity === 'warn' || f.severity === 'info')
        ? f.severity
        : 'info',
      message: f.message,
    } as { check: string; severity: 'block' | 'warn' | 'info'; message: string }));

    const honestyScore = typeof parsed.honesty_score === 'number'
      ? parsed.honesty_score
      : undefined;

    if (verdict === 'THEATER') {
      return {
        state: 'challenged',
        verifiedAt: now,
        verifierKind: 'diff-review',
        evidence: `detector verdict: THEATER, ${honestyScore ?? '?'}/100`,
        reason: findings.find(f => f.severity === 'block')?.message
          || 'diff-review detector flagged theater pattern',
        honestyScore,
        findings,
      };
    }

    // SUSPICIOUS → leave unverified but record warnings.
    // CLEAN → unverified unless upgraded later by a test-run promotion. We
    // intentionally do not auto-promote to `verified` here; a green pytest
    // does not prove correctness (see memory-verifier-spec.md rationale).
    return {
      state: 'unverified',
      verifiedAt: now,
      verifierKind: 'diff-review',
      evidence: `detector verdict: ${verdict}, ${honestyScore ?? '?'}/100`,
      honestyScore,
      findings,
    };
  }

  /**
   * Resolve the location of the theater-check.sh script. Checks:
   *   1. CODEBOT_THEATER_CHECK env var (explicit override)
   *   2. codebotPath('scripts', 'theater-check.sh') — installed location
   *   3. ../../scripts/theater-check.sh relative to this source — dev checkout
   * Returns null if none exist.
   */
  private resolveTheaterCheckPath(): string | null {
    const override = process.env.CODEBOT_THEATER_CHECK;
    if (override) return override;

    const installed = codebotPath('scripts', 'theater-check.sh');
    if (fs.existsSync(installed)) return installed;

    // Dev-checkout fallback: <repo>/scripts/theater-check.sh.
    // Walk up from __dirname looking for scripts/theater-check.sh.
    let dir = __dirname;
    for (let i = 0; i < 6; i++) {
      const candidate = path.join(dir, 'scripts', 'theater-check.sh');
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }

  /**
   * Build an episode from session data.
   */
  buildEpisode(opts: {
    sessionId: string;
    projectRoot: string;
    startedAt: string;
    goal: string;
    toolCalls: Array<{ tool: string; success: boolean }>;
    success: boolean;
    outcomes: string[];
    tokenUsage: { input: number; output: number };
  }): Episode {
    const toolsUsed = [...new Set(opts.toolCalls.map(t => t.tool))];
    const patterns = this.extractPatterns(opts.toolCalls);

    return {
      sessionId: opts.sessionId,
      projectRoot: opts.projectRoot,
      startedAt: opts.startedAt,
      endedAt: new Date().toISOString(),
      goal: opts.goal,
      toolsUsed,
      iterationCount: opts.toolCalls.length,
      success: opts.success,
      outcomes: opts.outcomes,
      patterns,
      tokenUsage: opts.tokenUsage,
    };
  }

  /**
   * Extract tool chain patterns from a sequence of tool calls.
   * Looks for consecutive tool sequences of length 2-4.
   */
  extractPatterns(toolCalls: Array<{ tool: string; success: boolean }>): EpisodePattern[] {
    if (toolCalls.length < 2) return [];

    const patternMap = new Map<string, EpisodePattern>();

    // Sliding window of sizes 2, 3, 4
    for (let windowSize = 2; windowSize <= Math.min(4, toolCalls.length); windowSize++) {
      for (let i = 0; i <= toolCalls.length - windowSize; i++) {
        const window = toolCalls.slice(i, i + windowSize);
        const chain = window.map(t => t.tool);
        const key = chain.join(' → ');

        if (!patternMap.has(key)) {
          const effective = window.every(t => t.success);
          patternMap.set(key, {
            description: `${chain.join(' → ')}`,
            toolChain: chain,
            effective,
            frequency: 1,
          });
        } else {
          patternMap.get(key)!.frequency++;
        }
      }
    }

    // Only keep patterns seen more than once or that are effective
    return [...patternMap.values()].filter(p => p.frequency > 1 || p.effective);
  }

  /**
   * Get top N patterns by success rate for system prompt injection.
   */
  getTopPatterns(n = 3): AggregatedPattern[] {
    const index = this.loadPatternIndex();
    const patterns = Object.values(index.patterns);

    // Filter to patterns with enough data and sort by success rate
    return patterns
      .filter(p => p.totalOccurrences >= 2)
      .sort((a, b) => {
        // Primary: success rate, secondary: total occurrences
        if (b.successRate !== a.successRate) return b.successRate - a.successRate;
        return b.totalOccurrences - a.totalOccurrences;
      })
      .slice(0, n);
  }

  /**
   * Get the most recent episodes, preferring the current project when provided.
   *
   * Filters out `challenged` episodes so a theater-flagged outcome never
   * surfaces as guidance. Within the remaining set, `verified` ranks above
   * `unverified`; ties resolve by honestyScore (desc) then endedAt (desc).
   *
   * This is the retrieval half of the anti-theater writeback. The writeback
   * half happens in `recordEpisode` via `runVerifier`.
   */
  getRecentEpisodes(n = 3, projectRoot?: string): Episode[] {
    const episodes = this.listEpisodes()
      .map(sessionId => this.getEpisode(sessionId))
      .filter((episode): episode is Episode => !!episode)
      .filter(e => e.verification?.state !== 'challenged')
      .sort((a, b) => {
        // verified > unverified (absent verification treated as unverified)
        const rank = (e: Episode) => e.verification?.state === 'verified' ? 1 : 0;
        if (rank(b) !== rank(a)) return rank(b) - rank(a);
        // higher honesty first (undefined honesty sorts as 50 — neutral)
        const hs = (e: Episode) => e.verification?.honestyScore ?? 50;
        if (hs(b) !== hs(a)) return hs(b) - hs(a);
        return b.endedAt.localeCompare(a.endedAt);
      });

    if (!projectRoot) return episodes.slice(0, n);

    const matching = episodes.filter(e => e.projectRoot === projectRoot);
    const others = episodes.filter(e => e.projectRoot !== projectRoot);
    return [...matching, ...others].slice(0, n);
  }

  /**
   * Get anti-patterns (low success rate) to avoid.
   */
  getAntiPatterns(n = 3): AggregatedPattern[] {
    const index = this.loadPatternIndex();
    const patterns = Object.values(index.patterns);

    return patterns
      .filter(p => p.totalOccurrences >= 3 && p.successRate < 0.3)
      .sort((a, b) => a.successRate - b.successRate)
      .slice(0, n);
  }

  /**
   * Format top patterns as a system prompt block.
   */
  buildPromptBlock(projectRoot?: string): string {
    const top = this.getTopPatterns(3);
    const anti = this.getAntiPatterns(2);
    const recent = this.getRecentEpisodes(3, projectRoot);

    if (top.length === 0 && anti.length === 0 && recent.length === 0) return '';

    const lines: string[] = ['## Cross-Session Patterns'];

    if (recent.length > 0) {
      lines.push('Recent remembered outcomes:');
      for (const episode of recent) {
        const outcome = episode.outcomes[0] || (episode.success ? 'Completed successfully' : 'Ended unsuccessfully');
        // Annotate with verification state so the model weights memory
        // correctly. Absent verification (legacy episodes) renders as
        // [unverified] — same treatment as new unverified outcomes.
        const tag = this.formatVerificationTag(episode);
        lines.push(`  - ${tag}${this.truncate(episode.goal, 90)} → ${this.truncate(outcome, 110)}`);
      }
    }

    if (top.length > 0) {
      lines.push('Effective patterns from previous sessions:');
      for (const p of top) {
        lines.push(`  - ${p.toolChain.join(' → ')} (${Math.round(p.successRate * 100)}% success, ${p.totalOccurrences} uses)`);
      }
    }

    if (anti.length > 0) {
      lines.push('Patterns to avoid:');
      for (const p of anti) {
        lines.push(`  - ${p.toolChain.join(' → ')} (${Math.round(p.successRate * 100)}% success — consider alternatives)`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get episode by session ID.
   */
  getEpisode(sessionId: string): Episode | null {
    const episodePath = path.join(this.episodesDir, `${sessionId}.json`);
    if (!fs.existsSync(episodePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(episodePath, 'utf-8'));
    } catch { return null; }
  }

  /**
   * List all episode session IDs, most recent first.
   */
  listEpisodes(): string[] {
    if (!fs.existsSync(this.episodesDir)) return [];

    try {
      return fs.readdirSync(this.episodesDir)
        .filter(f => f.endsWith('.json') && f !== 'index.json')
        .map(f => f.replace('.json', ''))
        .reverse();
    } catch { return []; }
  }

  /**
   * Get summary statistics across all episodes.
   */
  summarize(): string {
    const episodes = this.listEpisodes();
    if (episodes.length === 0) return 'No cross-session data recorded.';

    const index = this.loadPatternIndex();
    const patternCount = Object.keys(index.patterns).length;
    const topPatterns = this.getTopPatterns(3);

    const lines = [
      `Cross-Session Learning: ${episodes.length} episodes, ${patternCount} patterns`,
    ];

    if (topPatterns.length > 0) {
      lines.push('Top patterns:');
      for (const p of topPatterns) {
        lines.push(`  ${p.toolChain.join(' → ')} — ${Math.round(p.successRate * 100)}% success (${p.totalOccurrences}x)`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Prune old episodes, keeping only the most recent N.
   */
  prune(keepCount = 50): number {
    const episodes = this.listEpisodes();
    if (episodes.length <= keepCount) return 0;

    let pruned = 0;
    const toRemove = episodes.slice(keepCount);
    for (const sessionId of toRemove) {
      try {
        fs.unlinkSync(path.join(this.episodesDir, `${sessionId}.json`));
        pruned++;
      } catch { /* skip */ }
    }
    return pruned;
  }

  /**
   * Prune episodes older than the given age in days based on endedAt.
   * Episodes with unparseable timestamps are left alone.
   */
  pruneByAge(maxAgeDays: number): number {
    if (maxAgeDays <= 0) return 0;
    if (!fs.existsSync(this.episodesDir)) return 0;

    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    let pruned = 0;

    for (const sessionId of this.listEpisodes()) {
      const episodePath = path.join(this.episodesDir, `${sessionId}.json`);
      try {
        const raw = fs.readFileSync(episodePath, 'utf-8');
        const episode = JSON.parse(raw) as Episode;
        const ts = Date.parse(episode.endedAt || episode.startedAt || '');
        if (!Number.isFinite(ts)) continue;
        if (ts < cutoff) {
          fs.unlinkSync(episodePath);
          pruned++;
        }
      } catch { /* corrupt or unreadable — leave it */ }
    }

    return pruned;
  }

  // ── Internal ──

  private loadPatternIndex(): PatternIndex {
    if (this.patternIndex) return this.patternIndex;

    if (fs.existsSync(this.indexPath)) {
      try {
        this.patternIndex = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
        return this.patternIndex!;
      } catch { /* fall through */ }
    }

    this.patternIndex = { patterns: {}, updatedAt: new Date().toISOString() };
    return this.patternIndex;
  }

  private updatePatternIndex(episode: Episode): void {
    const index = this.loadPatternIndex();

    for (const pattern of episode.patterns) {
      const key = pattern.toolChain.join(':');

      if (!index.patterns[key]) {
        index.patterns[key] = {
          description: pattern.description,
          toolChain: pattern.toolChain,
          successCount: 0,
          failureCount: 0,
          totalOccurrences: 0,
          successRate: 0,
          lastSeen: episode.endedAt,
          sessionIds: [],
        };
      }

      const agg = index.patterns[key];
      agg.totalOccurrences += pattern.frequency;
      if (pattern.effective) {
        agg.successCount += pattern.frequency;
      } else {
        agg.failureCount += pattern.frequency;
      }
      agg.successRate = agg.totalOccurrences > 0
        ? agg.successCount / agg.totalOccurrences
        : 0;
      agg.lastSeen = episode.endedAt;
      if (!agg.sessionIds.includes(episode.sessionId)) {
        agg.sessionIds.push(episode.sessionId);
        // Keep only last 20 session IDs
        if (agg.sessionIds.length > 20) {
          agg.sessionIds = agg.sessionIds.slice(-20);
        }
      }
    }

    index.updatedAt = new Date().toISOString();
    this.patternIndex = index;

    try {
      fs.writeFileSync(this.indexPath, JSON.stringify(index, null, 2));
    } catch { /* best effort */ }
  }

  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3).trimEnd() + '...';
  }

  /**
   * Render a short tag that tells the model how much to trust a recalled
   * outcome. Absent or `unverified` with score >=70 → `[unverified] `.
   * `unverified` with score <70 → `[suspicious, score=NN] `. `verified`
   * → `[verified] `. Challenged episodes should never reach here (they are
   * filtered in getRecentEpisodes) but if one does, we fail loud with
   * `[CHALLENGED] `.
   */
  private formatVerificationTag(episode: Episode): string {
    const v = episode.verification;
    if (!v) return '[unverified] ';
    if (v.state === 'verified') return '[verified] ';
    if (v.state === 'challenged') return '[CHALLENGED] ';
    const score = v.honestyScore;
    if (typeof score === 'number' && score < 70) {
      return `[suspicious, score=${score}] `;
    }
    return '[unverified] ';
  }
}
