/**
 * Centralized path resolver for CodeBot state directories.
 *
 * All runtime state (sessions, vault, config, cache, audit, usage) lives
 * under a single root: CODEBOT_HOME env var, or ~/.codebot by default.
 *
 * This module exists so tests can override CODEBOT_HOME to a temp directory
 * without fighting module-level os.homedir() evaluation.
 */

import * as path from 'path';
import * as os from 'os';

/** Returns the CodeBot home directory. Respects CODEBOT_HOME env var for test isolation. */
export function codebotHome(): string {
  return process.env.CODEBOT_HOME || path.join(os.homedir(), '.codebot');
}

/** Convenience: resolve a path under codebotHome(). */
export function codebotPath(...segments: string[]): string {
  return path.join(codebotHome(), ...segments);
}
