import * as fs from 'fs';
import * as path from 'path';
import { encryptContent, decryptContent } from './encryption';
import { codebotPath } from './paths';

/** Default maximum size per memory file (64KB) */
const DEFAULT_MAX_FILE_SIZE = 64 * 1024;
/** Default maximum total prompt-injected memory size (256KB) */
const DEFAULT_MAX_TOTAL_SIZE = 256 * 1024;

/** Patterns that indicate potential prompt injection in memory content */
const INJECTION_PATTERNS = [
  /^(system|assistant|user):\s/i,
  /ignore (previous|all|above) instructions/i,
  /you are now/i,
  /new instructions:/i,
  /override:/i,
  /<\/?system>/i,
  /\bforget (all|everything|your)\b/i,
  /\bact as\b/i,
  /\brole:\s*(system|admin)/i,
  /\bpretend (you are|to be)\b/i,
];

/**
 * Sanitize memory content by stripping lines that look like prompt injection.
 */
export function sanitizeMemory(content: string): string {
  return content.split('\n')
    .filter(line => !INJECTION_PATTERNS.some(p => p.test(line)))
    .join('\n');
}

/**
 * Truncate content to a maximum byte size.
 */
function truncateToSize(content: string, maxSize: number): string {
  if (Buffer.byteLength(content, 'utf-8') <= maxSize) return content;
  // Truncate by chars (approximation — will be close to byte limit)
  let truncated = content;
  while (Buffer.byteLength(truncated, 'utf-8') > maxSize - 50) { // leave room for marker
    truncated = truncated.substring(0, Math.floor(truncated.length * 0.9));
  }
  return truncated.trimEnd() + '\n[truncated — exceeded size limit]';
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getMaxFileSize(): number {
  return parsePositiveIntEnv('CODEBOT_MEMORY_MAX_FILE_SIZE', DEFAULT_MAX_FILE_SIZE);
}

function getMaxTotalSize(): number {
  return parsePositiveIntEnv('CODEBOT_MEMORY_MAX_TOTAL_SIZE', DEFAULT_MAX_TOTAL_SIZE);
}

export interface MemoryEntry {
  key: string;
  value: string;
  source: 'user' | 'agent';
  created: string;
}

/**
 * Persistent memory system for CodeBot.
 * Stores project-level and global notes that survive across sessions.
 * Memory is injected into the system prompt so the model always has context.
 *
 * Security: content is sanitized before injection to prevent prompt injection.
 * Size limits: configurable via env, defaulting to 64KB per file and 256KB total.
 */
export class MemoryManager {
  private projectDir: string;
  private globalDir: string;

  constructor(projectRoot?: string) {
    this.projectDir = projectRoot
      ? path.join(projectRoot, '.codebot', 'memory')
      : '';
    this.globalDir = codebotPath('memory');
    fs.mkdirSync(this.globalDir, { recursive: true });
    if (this.projectDir) {
      fs.mkdirSync(this.projectDir, { recursive: true });
    }
  }

  /** Read the global memory file */
  readGlobal(): string {
    if (fs.existsSync(codebotPath('memory', 'MEMORY.md'))) {
      return decryptContent(fs.readFileSync(codebotPath('memory', 'MEMORY.md'), 'utf-8'));
    }
    return '';
  }

  /** Read project-level memory */
  readProject(): string {
    if (!this.projectDir) return '';
    const memFile = path.join(this.projectDir, 'MEMORY.md');
    if (fs.existsSync(memFile)) {
      return decryptContent(fs.readFileSync(memFile, 'utf-8'));
    }
    return '';
  }

  /** Write to global memory */
  writeGlobal(content: string): void {
    const safe = truncateToSize(content, getMaxFileSize());
    fs.writeFileSync(codebotPath('memory', 'MEMORY.md'), encryptContent(safe));
  }

  /** Write to project memory */
  writeProject(content: string): void {
    if (!this.projectDir) return;
    const memFile = path.join(this.projectDir, 'MEMORY.md');
    const safe = truncateToSize(content, getMaxFileSize());
    fs.writeFileSync(memFile, encryptContent(safe));
  }

  /** Append an entry to global memory */
  appendGlobal(entry: string): void {
    const current = this.readGlobal();
    const updated = current ? `${current.trimEnd()}\n\n${entry}` : entry;
    this.writeGlobal(updated);
  }

  /** Append an entry to project memory */
  appendProject(entry: string): void {
    if (!this.projectDir) return;
    const current = this.readProject();
    const updated = current ? `${current.trimEnd()}\n\n${entry}` : entry;
    this.writeProject(updated);
  }

  readFile(scope: 'global' | 'project', file: string): string {
    const filePath = this.resolveFilePath(scope, file);
    if (!filePath || !fs.existsSync(filePath)) return `(no file: ${this.sanitizeFileName(file)})`;
    return decryptContent(fs.readFileSync(filePath, 'utf-8'));
  }

  writeFile(scope: 'global' | 'project', file: string, content: string): string {
    const filePath = this.resolveFilePath(scope, file);
    if (!filePath) return 'Error: project memory is unavailable outside a project';

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const safe = truncateToSize(content, getMaxFileSize());
    fs.writeFileSync(filePath, encryptContent(safe));
    return `Wrote ${path.basename(filePath)} (${scope}).`;
  }

  /** Read all memory files from a directory */
  private readDir(dir: string): Record<string, string> {
    const files: Record<string, string> = {};
    if (!fs.existsSync(dir)) return files;

    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.md')) continue;
      files[name] = decryptContent(fs.readFileSync(path.join(dir, name), 'utf-8'));
    }
    return files;
  }

  /** Get all memory content formatted for system prompt injection */
  getContextBlock(): string {
    const parts: string[] = [];
    let totalSize = 0;
    const maxFileSize = getMaxFileSize();
    const maxTotalSize = getMaxTotalSize();

    const global = this.readGlobal();
    if (global.trim()) {
      const sanitized = sanitizeMemory(global.trim());
      const truncated = truncateToSize(sanitized, maxFileSize);
      totalSize += Buffer.byteLength(truncated, 'utf-8');
      parts.push(`## Global Memory\n${truncated}`);
    }

    // Read additional global topic files
    const globalFiles = this.readDir(this.globalDir);
    for (const [name, content] of Object.entries(globalFiles)) {
      if (name === 'MEMORY.md' || !content.trim()) continue;
      if (totalSize >= maxTotalSize) break;

      const sanitized = sanitizeMemory(content.trim());
      const remaining = maxTotalSize - totalSize;
      const truncated = truncateToSize(sanitized, Math.min(maxFileSize, remaining));
      totalSize += Buffer.byteLength(truncated, 'utf-8');
      parts.push(`## ${name.replace('.md', '')}\n${truncated}`);
    }

    const project = this.readProject();
    if (project.trim() && totalSize < maxTotalSize) {
      const sanitized = sanitizeMemory(project.trim());
      const remaining = maxTotalSize - totalSize;
      const truncated = truncateToSize(sanitized, Math.min(maxFileSize, remaining));
      totalSize += Buffer.byteLength(truncated, 'utf-8');
      parts.push(`## Project Memory\n${truncated}`);
    }

    // Read additional project topic files
    if (this.projectDir) {
      const projFiles = this.readDir(this.projectDir);
      for (const [name, content] of Object.entries(projFiles)) {
        if (name === 'MEMORY.md' || !content.trim()) continue;
        if (totalSize >= maxTotalSize) break;

        const sanitized = sanitizeMemory(content.trim());
        const remaining = maxTotalSize - totalSize;
        const truncated = truncateToSize(sanitized, Math.min(maxFileSize, remaining));
        totalSize += Buffer.byteLength(truncated, 'utf-8');
        parts.push(`## Project: ${name.replace('.md', '')}\n${truncated}`);
      }
    }

    if (parts.length === 0) return '';
    return `\n\n--- Persistent Memory ---\n${parts.join('\n\n')}`;
  }

  /** List all memory files */
  list(): Array<{ scope: 'global' | 'project'; file: string; size: number }> {
    const result: Array<{ scope: 'global' | 'project'; file: string; size: number }> = [];

    if (fs.existsSync(this.globalDir)) {
      for (const name of fs.readdirSync(this.globalDir)) {
        if (!name.endsWith('.md')) continue;
        const stat = fs.statSync(path.join(this.globalDir, name));
        result.push({ scope: 'global', file: name, size: stat.size });
      }
    }

    if (this.projectDir && fs.existsSync(this.projectDir)) {
      for (const name of fs.readdirSync(this.projectDir)) {
        if (!name.endsWith('.md')) continue;
        const stat = fs.statSync(path.join(this.projectDir, name));
        result.push({ scope: 'project', file: name, size: stat.size });
      }
    }

    return result;
  }

  private getDir(scope: 'global' | 'project'): string | null {
    if (scope === 'global') return this.globalDir;
    return this.projectDir || null;
  }

  private sanitizeFileName(file: string): string {
    const base = path.basename(file);
    return base.endsWith('.md') ? base : `${base}.md`;
  }

  private resolveFilePath(scope: 'global' | 'project', file: string): string | null {
    const dir = this.getDir(scope);
    if (!dir) return null;
    return path.join(dir, this.sanitizeFileName(file));
  }
}
