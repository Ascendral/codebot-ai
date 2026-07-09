/**
 * Centralized path resolver for AgentTrail state directories.
 *
 * All runtime state (sessions, vault, config, cache, audit, usage) lives
 * under a single root: AGENTTRAIL_HOME env var, or ~/.agenttrail by default.
 *
 * This module exists so tests can override AGENTTRAIL_HOME to a temp directory
 * without fighting module-level os.homedir() evaluation.
 */

import * as path from 'path';
import * as os from 'os';

/** Returns the AgentTrail home directory. Respects AGENTTRAIL_HOME env var for test isolation. */
export function trailHome(): string {
  return process.env.AGENTTRAIL_HOME || path.join(os.homedir(), '.agenttrail');
}

/** Convenience: resolve a path under trailHome(). */
export function trailPath(...segments: string[]): string {
  return path.join(trailHome(), ...segments);
}
