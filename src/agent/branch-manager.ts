import type { PolicyEnforcer } from '../policy';
import type { Message } from '../types';

/**
 * Auto-create a feature branch when always_branch is enabled and on main/master.
 * Called before the first write/edit operation. Fail-open: if branching fails,
 * the operation continues without a branch.
 *
 * Holds the once-per-session `branchCreated` flag so retries are idempotent.
 */
export class BranchManager {
  private branchCreated: boolean = false;

  constructor(private readonly policy: PolicyEnforcer) {}

  async ensureBranch(messages: Message[], projectRoot: string): Promise<string | null> {
    if (this.branchCreated) return null;
    if (!this.policy.shouldAlwaysBranch()) return null;

    try {
      const { execSync } = require('child_process');
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: projectRoot,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();

      if (currentBranch !== 'main' && currentBranch !== 'master') {
        this.branchCreated = true;
        return null; // Already on a feature branch
      }

      // Generate branch name from first user message
      const firstUserMsg = messages.find((m) => m.role === 'user');
      const prefix = this.policy.getBranchPrefix();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const slug = sanitizeSlug(firstUserMsg?.content || 'task');
      const branchName = `${prefix}${timestamp}-${slug}`;

      execSync(`git checkout -b "${branchName}"`, {
        cwd: projectRoot,
        encoding: 'utf-8',
        timeout: 10000,
      });

      this.branchCreated = true;
      return branchName;
    } catch {
      // Don't block the operation if branching fails (not in a git repo, etc.)
      this.branchCreated = true; // Don't retry
      return null;
    }
  }
}

/** Sanitize user message into a branch-safe slug. Pure function, exported for tests. */
export function sanitizeSlug(message: string): string {
  return (
    message
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 30)
      .replace(/-+$/, '') || 'task'
  );
}
