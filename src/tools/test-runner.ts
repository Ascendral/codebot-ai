import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Tool } from '../types';

interface FrameworkInfo {
  name: string;
  command: string;
  filePattern: string;
}

export class TestRunnerTool implements Tool {
  name = 'test_runner';
  description = 'Run tests with auto-detected framework. Actions: run (execute tests), detect (show detected framework), list (list test files).';
  permission: Tool['permission'] = 'prompt';
  parameters = {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Action: run, detect, list' },
      path: { type: 'string', description: 'Test file or directory (defaults to project root)' },
      filter: { type: 'string', description: 'Test name filter / grep pattern' },
      cwd: { type: 'string', description: 'Working directory' },
    },
    required: ['action'],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const action = args.action as string;
    if (!action) return 'Error: action is required';

    const cwd = (args.cwd as string) || process.cwd();

    switch (action) {
      case 'detect': return this.detectFramework(cwd);
      case 'list': return this.listTestFiles(cwd);
      case 'run': return this.runTests(cwd, args);
      default: return `Error: unknown action "${action}". Use: run, detect, list`;
    }
  }

  private detectFramework(cwd: string): string {
    const fw = this.detect(cwd);
    if (!fw) return 'No test framework detected. Checked for: jest, vitest, mocha, node:test, pytest, go test, cargo test.';
    return `Detected: ${fw.name}\nCommand: ${fw.command}\nTest files: ${fw.filePattern}`;
  }

  private listTestFiles(cwd: string): string {
    const patterns = ['**/*.test.*', '**/*.spec.*', '**/test_*.py', '**/*_test.go', '**/tests/**'];
    const files: string[] = [];
    const skip = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);

    this.findTests(cwd, files, skip, 0, 4);
    if (files.length === 0) return 'No test files found.';
    return `Test files (${files.length}):\n${files.map(f => `  ${f}`).join('\n')}`;
  }

  private runTests(cwd: string, args: Record<string, unknown>): string {
    const fw = this.detect(cwd);
    if (!fw) return 'Error: no test framework detected';

    let cmd = fw.command;
    const target = args.path as string;
    const filter = args.filter as string;

    if (target) cmd += ` ${target}`;
    if (filter) {
      if (fw.name.includes('jest') || fw.name.includes('vitest')) cmd += ` -t "${filter}"`;
      else if (fw.name === 'pytest') cmd += ` -k "${filter}"`;
      else if (fw.name === 'go test') cmd += ` -run "${filter}"`;
    }

    try {
      const output = execSync(cmd, {
        cwd,
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return this.summarize(output, fw.name);
    } catch (err: unknown) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      const combined = `${e.stdout || ''}\n${e.stderr || ''}`.trim();
      return `Tests failed (exit ${e.status || 1}):\n${this.summarize(combined, fw.name)}`;
    }
  }

  private detect(cwd: string): FrameworkInfo | null {
    // Check package.json for JS/TS projects
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const scripts = pkg.scripts || {};
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        if (scripts.test) {
          if (scripts.test.includes('vitest')) return { name: 'vitest', command: 'npx vitest run', filePattern: '*.test.ts' };
          if (scripts.test.includes('jest')) return { name: 'jest', command: 'npx jest', filePattern: '*.test.ts' };
          if (scripts.test.includes('mocha')) return { name: 'mocha', command: 'npx mocha', filePattern: '*.test.ts' };
          if (scripts.test.includes('node --test')) return { name: 'node:test', command: scripts.test, filePattern: '*.test.ts' };
          // Generic npm test
          return { name: 'npm test', command: 'npm test', filePattern: '*.test.*' };
        }
        if (deps['vitest']) return { name: 'vitest', command: 'npx vitest run', filePattern: '*.test.ts' };
        if (deps['jest']) return { name: 'jest', command: 'npx jest', filePattern: '*.test.ts' };
      } catch { /* invalid package.json */ }
    }

    // Python
    if (fs.existsSync(path.join(cwd, 'pytest.ini')) || fs.existsSync(path.join(cwd, 'setup.py')) || fs.existsSync(path.join(cwd, 'pyproject.toml'))) {
      return { name: 'pytest', command: 'python -m pytest -v', filePattern: 'test_*.py' };
    }

    // Go
    if (fs.existsSync(path.join(cwd, 'go.mod'))) {
      return { name: 'go test', command: 'go test ./...', filePattern: '*_test.go' };
    }

    // Rust
    if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
      return { name: 'cargo test', command: 'cargo test', filePattern: '*.rs' };
    }

    return null;
  }

  private summarize(output: string, framework: string): string {
    const lines = output.split('\n');
    const summary: string[] = [];

    // Extract pass/fail counts
    for (const line of lines) {
      if (/(?:pass|fail|error|skip|pending|test|ok|FAIL)/i.test(line) && line.trim().length < 200) {
        summary.push(line);
      }
    }

    if (summary.length > 30) {
      return summary.slice(-30).join('\n') + '\n...(truncated)';
    }
    return summary.length > 0 ? summary.join('\n') : output.substring(0, 2000);
  }

  private findTests(dir: string, files: string[], skip: Set<string>, depth: number, maxDepth: number): void {
    if (depth >= maxDepth) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        this.findTests(full, files, skip, depth + 1, maxDepth);
      } else if (/\.(test|spec)\.\w+$/.test(entry.name) || /^test_.*\.py$/.test(entry.name) || /_test\.go$/.test(entry.name)) {
        files.push(full);
      }
    }
  }
}
