import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Tool } from '../types';

interface PkgManager {
  name: string;
  install: string;
  add: string;
  remove: string;
  list: string;
  outdated: string;
  audit: string;
}

const MANAGERS: Record<string, PkgManager> = {
  npm: {
    name: 'npm', install: 'npm install', add: 'npm install',
    remove: 'npm uninstall', list: 'npm ls --depth=0', outdated: 'npm outdated', audit: 'npm audit',
  },
  yarn: {
    name: 'yarn', install: 'yarn install', add: 'yarn add',
    remove: 'yarn remove', list: 'yarn list --depth=0', outdated: 'yarn outdated', audit: 'yarn audit',
  },
  pnpm: {
    name: 'pnpm', install: 'pnpm install', add: 'pnpm add',
    remove: 'pnpm remove', list: 'pnpm ls --depth=0', outdated: 'pnpm outdated', audit: 'pnpm audit',
  },
  pip: {
    name: 'pip', install: 'pip install -r requirements.txt', add: 'pip install',
    remove: 'pip uninstall -y', list: 'pip list', outdated: 'pip list --outdated', audit: 'pip audit',
  },
  cargo: {
    name: 'cargo', install: 'cargo build', add: 'cargo add',
    remove: 'cargo remove', list: 'cargo tree --depth=1', outdated: 'cargo outdated', audit: 'cargo audit',
  },
  go: {
    name: 'go', install: 'go mod download', add: 'go get',
    remove: 'go mod tidy', list: 'go list -m all', outdated: 'go list -m -u all', audit: 'govulncheck ./...',
  },
};

export class PackageManagerTool implements Tool {
  name = 'package_manager';
  description = 'Manage dependencies. Auto-detects npm/yarn/pnpm/pip/cargo/go. Actions: install, add, remove, list, outdated, audit, detect.';
  permission: Tool['permission'] = 'prompt';
  parameters = {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Action: install, add, remove, list, outdated, audit, detect' },
      package: { type: 'string', description: 'Package name (for add/remove)' },
      cwd: { type: 'string', description: 'Working directory' },
      manager: { type: 'string', description: 'Force specific manager (npm, yarn, pnpm, pip, cargo, go)' },
    },
    required: ['action'],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const action = args.action as string;
    if (!action) return 'Error: action is required';

    const cwd = (args.cwd as string) || process.cwd();

    if (action === 'detect') {
      const mgr = this.detect(cwd, args.manager as string);
      return mgr ? `Detected: ${mgr.name}` : 'No package manager detected.';
    }

    const mgr = this.detect(cwd, args.manager as string);
    if (!mgr) return 'Error: no package manager detected. Specify with manager parameter.';

    let cmd: string;
    switch (action) {
      case 'install': cmd = mgr.install; break;
      case 'add': {
        const pkg = args.package as string;
        if (!pkg) return 'Error: package name is required for add';
        cmd = `${mgr.add} ${pkg}`;
        break;
      }
      case 'remove': {
        const pkg = args.package as string;
        if (!pkg) return 'Error: package name is required for remove';
        cmd = `${mgr.remove} ${pkg}`;
        break;
      }
      case 'list': cmd = mgr.list; break;
      case 'outdated': cmd = mgr.outdated; break;
      case 'audit': cmd = mgr.audit; break;
      default: return `Error: unknown action "${action}". Use: install, add, remove, list, outdated, audit, detect`;
    }

    try {
      const output = execSync(cmd, {
        cwd,
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output.trim() || '(no output)';
    } catch (err: unknown) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      // Audit and outdated commands often exit non-zero when issues are found
      if (['audit', 'outdated'].includes(action) && e.stdout) {
        return e.stdout.trim();
      }
      return `Exit ${e.status || 1}:\n${(e.stdout || '').trim()}\n${(e.stderr || '').trim()}`.trim();
    }
  }

  private detect(cwd: string, forced?: string): PkgManager | null {
    if (forced && MANAGERS[forced]) return MANAGERS[forced];

    // Check lock files
    if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return MANAGERS.pnpm;
    if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return MANAGERS.yarn;
    if (fs.existsSync(path.join(cwd, 'package-lock.json')) || fs.existsSync(path.join(cwd, 'package.json'))) return MANAGERS.npm;
    if (fs.existsSync(path.join(cwd, 'requirements.txt')) || fs.existsSync(path.join(cwd, 'setup.py')) || fs.existsSync(path.join(cwd, 'pyproject.toml'))) return MANAGERS.pip;
    if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) return MANAGERS.cargo;
    if (fs.existsSync(path.join(cwd, 'go.mod'))) return MANAGERS.go;

    return null;
  }
}
