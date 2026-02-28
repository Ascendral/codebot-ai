import { execSync } from 'child_process';
import { Tool } from '../types';

const ALLOWED_ACTIONS = [
  'status', 'diff', 'log', 'commit', 'branch', 'checkout',
  'stash', 'push', 'pull', 'merge', 'blame', 'tag', 'add', 'reset',
];

export class GitTool implements Tool {
  name = 'git';
  description = 'Run git operations. Actions: status, diff, log, commit, branch, checkout, stash, push, pull, merge, blame, tag, add, reset.';
  permission: Tool['permission'] = 'prompt';
  parameters = {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Git action (status, diff, log, commit, branch, checkout, stash, push, pull, merge, blame, tag, add, reset)' },
      args: { type: 'string', description: 'Additional arguments (e.g., file path, branch name, commit message)' },
      cwd: { type: 'string', description: 'Working directory (defaults to current)' },
    },
    required: ['action'],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const action = args.action as string;
    if (!action) return 'Error: action is required';

    if (!ALLOWED_ACTIONS.includes(action)) {
      return `Error: unknown action "${action}". Allowed: ${ALLOWED_ACTIONS.join(', ')}`;
    }

    const extra = (args.args as string) || '';
    const cwd = (args.cwd as string) || process.cwd();

    // Block destructive force operations
    const fullCmd = `git ${action} ${extra}`.trim();
    if (/--force\s+.*(main|master)/i.test(fullCmd)) {
      return 'Error: force push to main/master is blocked for safety.';
    }
    if (/clean\s+-[a-z]*f/i.test(fullCmd)) {
      return 'Error: git clean -f is blocked for safety.';
    }

    try {
      const output = execSync(fullCmd, {
        cwd,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output.trim() || '(no output)';
    } catch (err: unknown) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      const stderr = (e.stderr || '').trim();
      const stdout = (e.stdout || '').trim();
      return `Exit ${e.status || 1}${stdout ? `\n${stdout}` : ''}${stderr ? `\nError: ${stderr}` : ''}`;
    }
  }
}
