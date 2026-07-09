/**
 * Protocol installer. Targets, in order of what exists in the project:
 *  - CLAUDE.md          (Claude Code — created if nothing else exists)
 *  - .cursorrules       (Cursor, legacy single-file form — only if present)
 *  - AGENTS.md          (Codex/other agents convention — only if present)
 *
 * Idempotent: an existing protocol block (any version) is replaced in
 * place; everything around it is preserved byte-for-byte. A file is
 * never rewritten wholesale, and a corrupt/unreadable file aborts that
 * target instead of clobbering it.
 */

import * as fs from 'fs';
import * as path from 'path';
import { protocolBlock, ANY_BLOCK_RE, START_MARKER, PROTOCOL_VERSION } from './protocol-text';

export interface TargetResult {
  file: string;
  action: 'created' | 'updated' | 'already-current' | 'appended';
}

const OPTIONAL_TARGETS = ['.cursorrules', 'AGENTS.md'];
const PRIMARY_TARGET = 'CLAUDE.md';

function installIntoFile(filePath: string): TargetResult {
  const rel = path.basename(filePath);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, protocolBlock() + '\n');
    return { file: rel, action: 'created' };
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  if (content.includes(START_MARKER)) {
    return { file: rel, action: 'already-current' };
  }
  if (ANY_BLOCK_RE.test(content)) {
    // Older version installed — upgrade the block in place
    fs.writeFileSync(filePath, content.replace(ANY_BLOCK_RE, protocolBlock()));
    return { file: rel, action: 'updated' };
  }
  // No block yet — append, preserving what's there
  const sep = content.endsWith('\n') ? '\n' : '\n\n';
  fs.writeFileSync(filePath, content + sep + protocolBlock() + '\n');
  return { file: rel, action: 'appended' };
}

/** Install the protocol into a project directory. */
export function installProtocol(projectRoot: string): TargetResult[] {
  const results: TargetResult[] = [];

  // Primary target always gets the protocol (created if missing)
  results.push(installIntoFile(path.join(projectRoot, PRIMARY_TARGET)));

  // Optional targets only if the project already uses them
  for (const target of OPTIONAL_TARGETS) {
    const p = path.join(projectRoot, target);
    if (fs.existsSync(p)) {
      results.push(installIntoFile(p));
    }
  }
  return results;
}

export interface CheckResult {
  file: string;
  status: 'current' | 'outdated' | 'missing';
}

/** Report protocol presence/version across known targets. */
export function checkProtocol(projectRoot: string): CheckResult[] {
  const results: CheckResult[] = [];
  for (const target of [PRIMARY_TARGET, ...OPTIONAL_TARGETS]) {
    const p = path.join(projectRoot, target);
    if (!fs.existsSync(p)) {
      if (target === PRIMARY_TARGET) results.push({ file: target, status: 'missing' });
      continue;
    }
    const content = fs.readFileSync(p, 'utf-8');
    if (content.includes(START_MARKER)) {
      results.push({ file: target, status: 'current' });
    } else if (ANY_BLOCK_RE.test(content)) {
      results.push({ file: target, status: 'outdated' });
    } else {
      results.push({ file: target, status: 'missing' });
    }
  }
  return results;
}

export { PROTOCOL_VERSION };
