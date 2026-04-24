/**
 * Graphics Tool — Image processing, SVG generation & asset creation.
 *
 * Uses ImageMagick (magick/convert) when available for raster operations,
 * falls back to macOS `sips` for a subset of actions. SVG generation and
 * favicon creation from SVG work without any external dependency.
 *
 * Actions: resize, convert, compress, crop, watermark, info,
 *          svg, favicon, og_image, combine.
 *
 * Row 12 fix (2026-04-24):
 * Pre-fix, every exec sink used `execSync(\`${cmd} ${argsString}\`)` with
 * agent-supplied inputs (paths, text, format, numeric dimensions) pasted
 * straight into the string. That routes through `sh -c` on Unix and
 * `cmd.exe /c` on Windows. A malicious `output = 'x"; touch /tmp/pwned; echo "'`
 * broke out of the quote and executed the `touch` branch. Same bug class
 * as Rows 9, 10 and 12. Agent reached it with a single `prompt`-tier
 * approval — a one-click RCE primitive.
 *
 * This file now:
 *   - Uses `execFileSync(cmd, argv)`. No shell involved.
 *   - Validates numeric dimensions, colors, and format against whitelists.
 *   - Contains every input/output/derived path under `process.cwd()` using
 *     `path.relative` (sibling-prefix safe).
 *   - Exposes `buildMagickPlan()` — a pure seam that returns the planned
 *     (command, argv) without executing, so tests can pin the argv contract.
 *
 * Same `projectRoot` limitation as Row 10's TestRunnerTool — the tool is
 * constructed without knowledge of the agent's project root, so it gates
 * against `process.cwd()`. Tracked in Issue #17.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { Tool } from '../types';

// ─── Containment ────────────────────────────────────────────────────────────

/**
 * Decide whether `target` is contained within `root`.
 * Uses path.relative, not startsWith — the latter trips on sibling prefixes
 * like `/tmp/foo` vs `/tmp/foo-evil`.
 */
function isContained(root: string, target: string): boolean {
  const absRoot = path.resolve(root);
  const absTarget = path.resolve(target);
  if (absRoot === absTarget) return true;
  const rel = path.relative(absRoot, absTarget);
  if (!rel) return true;
  if (rel.startsWith('..')) return false;
  if (path.isAbsolute(rel)) return false;
  return true;
}

/**
 * Resolve `p` against `root` and reject if the result escapes.
 * Returns the absolute resolved path on success, or an error string.
 */
function resolveInside(root: string, p: string, label: string):
  { resolved: string } | { error: string } {
  const resolved = path.resolve(root, p);
  if (!isContained(root, resolved)) {
    return { error: `Error: ${label} escapes project root (${resolved} not under ${root})` };
  }
  return { resolved };
}

// ─── Validators ─────────────────────────────────────────────────────────────

/**
 * Validate a value is a finite non-negative integer. TypeScript's `as number`
 * cast is erased at runtime — the agent can still send a string. Guard here.
 */
function validateInt(v: unknown, name: string, min = 0, max = 100_000):
  { n: number } | { error: string } {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    return { error: `Error: ${name} must be a finite integer in [${min}, ${max}]` };
  }
  return { n };
}

const ALLOWED_FORMATS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'ico']);

function validateFormat(v: unknown):
  { ok: string } | { error: string } {
  if (typeof v !== 'string' || !ALLOWED_FORMATS.has(v.toLowerCase())) {
    return { error: `Error: format must be one of ${[...ALLOWED_FORMATS].join(', ')}` };
  }
  return { ok: v.toLowerCase() };
}

/**
 * Hex color validator. Accepts #RGB, #RRGGBB, #RRGGBBAA (3, 6, or 8 hex
 * digits after the hash). Returns an error rather than a silent fallback
 * because silent fallback can hide hostile input in an otherwise-valid SVG.
 */
function validateHexColor(v: unknown, name: string):
  { ok: string } | { error: string } {
  if (typeof v !== 'string' || !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) {
    return { error: `Error: ${name} must be a hex color (#RGB, #RRGGBB, #RRGGBBAA)` };
  }
  return { ok: v };
}

// ─── ImageMagick probe (cached) ─────────────────────────────────────────────

/**
 * Probe once, cache forever. Expanding the probe into every action call
 * would make the tool flaky and slow. A process-lifetime cache is fine
 * because the binary state doesn't change mid-run.
 */
let _magickCache: { present: boolean; cmd: 'magick' | 'convert' | null } | null = null;

function probeMagick(): { present: boolean; cmd: 'magick' | 'convert' | null } {
  if (_magickCache !== null) return _magickCache;
  try {
    execFileSync('magick', ['--version'], { stdio: 'pipe', timeout: 5_000 });
    _magickCache = { present: true, cmd: 'magick' };
    return _magickCache;
  } catch { /* fall through */ }
  try {
    execFileSync('convert', ['--version'], { stdio: 'pipe', timeout: 5_000 });
    _magickCache = { present: true, cmd: 'convert' };
    return _magickCache;
  } catch { /* fall through */ }
  _magickCache = { present: false, cmd: null };
  return _magickCache;
}

function hasMagick(): boolean { return probeMagick().present; }
function magickCmd(): string { return probeMagick().cmd ?? 'magick'; }

/** Reset the magick probe cache. Exposed for tests only. */
export function __resetMagickCache(): void { _magickCache = null; }

// ─── Exec helpers ───────────────────────────────────────────────────────────

/**
 * Run magick/convert with an argv array. No shell. Metacharacters inside
 * argv elements stay literal.
 */
function runMagickArgv(argv: string[]): string {
  try {
    return execFileSync(magickCmd(), argv, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    }).toString().trim();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`ImageMagick error: ${msg.substring(0, 200)}`);
  }
}

/** Run sips with an argv array. No shell. */
function runSipsArgv(argv: string[]): string {
  try {
    return execFileSync('sips', argv, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
    }).toString().trim();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`sips error: ${msg.substring(0, 200)}`);
  }
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** Compute a default output path from the input path, preserving extension. */
function defaultOutput(input: string, suffix: string, ext?: string): string {
  const inExt = path.extname(input);
  const useExt = ext !== undefined ? ext : inExt;
  return input.slice(0, input.length - inExt.length) + suffix + useExt;
}

/**
 * Escape user text for embedding inside SVG text nodes. Attribute context
 * has the same five replacements.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── Plan type exported for tests ───────────────────────────────────────────

export type MagickPlan =
  | { backend: 'magick'; argv: string[] }
  | { backend: 'sips'; argv: string[] }
  | { error: string };

// ───────────────────────────────────────────────────────────────────────────

export class GraphicsTool implements Tool {
  name = 'graphics';
  description = 'Image processing, SVG generation & design assets. Actions: resize, convert, compress, crop, watermark, info, svg, favicon, og_image, combine. Uses ImageMagick/sips.';
  permission: Tool['permission'] = 'prompt';
  parameters = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action: resize, convert, compress, crop, watermark, info, svg, favicon, og_image, combine',
      },
      input: { type: 'string', description: 'Input image path (must be inside project root)' },
      output: { type: 'string', description: 'Output path (auto-generated if omitted; must be inside project root)' },
      width: { type: 'number', description: 'Target width in pixels' },
      height: { type: 'number', description: 'Target height in pixels' },
      format: { type: 'string', description: 'Output format: png, jpg, jpeg, webp, gif, svg, ico' },
      quality: { type: 'number', description: 'Compression quality 1-100 (for jpg/webp)' },
      // SVG specific
      svg_content: { type: 'string', description: 'SVG markup content (for svg action)' },
      svg_type: { type: 'string', description: 'SVG template: icon, badge, chart, logo, pattern' },
      // Watermark
      text: { type: 'string', description: 'Text for watermark or OG image' },
      position: { type: 'string', description: 'Position: center, top-left, top-right, bottom-left, bottom-right' },
      // OG image
      title: { type: 'string', description: 'Title text for OG image' },
      subtitle: { type: 'string', description: 'Subtitle for OG image' },
      bg_color: { type: 'string', description: 'Background color (hex, e.g., #1a1a2e)' },
      text_color: { type: 'string', description: 'Text color (hex, e.g., #ffffff)' },
      accent_color: { type: 'string', description: 'Accent color (hex, e.g., #6366f1)' },
      // Combine/sprite
      inputs: { type: 'string', description: 'Comma-separated list of input image paths (for combine/sprite)' },
      direction: { type: 'string', description: 'Combine direction: horizontal, vertical, grid' },
      // Crop
      x: { type: 'number', description: 'Crop X offset' },
      y: { type: 'number', description: 'Crop Y offset' },
      // Favicon
      sizes: { type: 'string', description: 'Comma-separated icon sizes (default: 16,32,48,64,128,256)' },
    },
    required: ['action'],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const action = args.action as string;
    if (!action) return 'Error: action is required';

    switch (action) {
      case 'resize': return this.resize(args);
      case 'convert': return this.convert(args);
      case 'compress': return this.compress(args);
      case 'crop': return this.crop(args);
      case 'watermark': return this.watermark(args);
      case 'info': return this.info(args);
      case 'svg': return this.svg(args);
      case 'favicon': return this.favicon(args);
      case 'og_image': return this.ogImage(args);
      case 'combine': return this.combine(args);
      default: return `Error: unknown action "${action}". Available: resize, convert, compress, crop, watermark, info, svg, favicon, og_image, combine`;
    }
  }

  /**
   * Pure seam for tests. Returns the planned (backend, argv) without
   * executing. Lets tests pin the argv contract and catch regressions to
   * string interpolation without stubbing child_process (whose exports are
   * read-only getters in modern Node).
   */
  public buildMagickPlan(
    action: string,
    args: Record<string, unknown>,
    cwd: string = process.cwd(),
  ): MagickPlan {
    switch (action) {
      case 'resize': return this.planResize(args, cwd);
      case 'convert': return this.planConvert(args, cwd);
      case 'compress': return this.planCompress(args, cwd);
      case 'crop': return this.planCrop(args, cwd);
      case 'watermark': return this.planWatermark(args, cwd);
      case 'info': return this.planInfo(args, cwd);
      case 'combine': return this.planCombine(args, cwd);
      case 'og_image': return this.planOgImagePng(args, cwd);
      default: return { error: `Error: no plan for action "${action}"` };
    }
  }

  // ─── resize ──────────────────────────────────────────────────────────────

  private planResize(args: Record<string, unknown>, cwd: string): MagickPlan {
    if (typeof args.input !== 'string' || args.input.length === 0) {
      return { error: 'Error: input path is required' };
    }
    const inRes = resolveInside(cwd, args.input, 'input');
    if ('error' in inRes) return inRes;

    const hasW = args.width !== undefined && args.width !== null;
    const hasH = args.height !== undefined && args.height !== null;
    if (!hasW && !hasH) return { error: 'Error: width or height is required' };

    let w: number | null = null;
    let h: number | null = null;
    if (hasW) {
      const r = validateInt(args.width, 'width', 1);
      if ('error' in r) return r;
      w = r.n;
    }
    if (hasH) {
      const r = validateInt(args.height, 'height', 1);
      if ('error' in r) return r;
      h = r.n;
    }

    const geometry = w !== null && h !== null ? `${w}x${h}!` : w !== null ? `${w}x` : `x${h}`;
    const wLabel = w ?? '';
    const hLabel = h ?? '';
    const defOut = defaultOutput(inRes.resolved, `-${wLabel}x${hLabel}`);
    const outPath = typeof args.output === 'string' && args.output.length > 0 ? args.output : defOut;
    const outRes = resolveInside(cwd, outPath, 'output');
    if ('error' in outRes) return outRes;

    if (hasMagick()) {
      return { backend: 'magick', argv: [inRes.resolved, '-resize', geometry, outRes.resolved] };
    }
    if (os.platform() === 'darwin') {
      // sips modifies in place. The wrapper (runTests-style) copies first.
      const sipsArgv = w !== null && h !== null
        ? ['-z', String(h), String(w), outRes.resolved]
        : w !== null
          ? ['--resampleWidth', String(w), outRes.resolved]
          : ['--resampleHeight', String(h), outRes.resolved];
      return { backend: 'sips', argv: sipsArgv };
    }
    return { error: 'Error: ImageMagick not found. Install with: brew install imagemagick (macOS) or apt install imagemagick (Linux)' };
  }

  private resize(args: Record<string, unknown>): string {
    const plan = this.planResize(args, process.cwd());
    if ('error' in plan) return plan.error;
    try {
      if (plan.backend === 'sips') {
        // Derive the resolved input/output from the plan's last arg.
        const outPath = plan.argv[plan.argv.length - 1];
        // Re-resolve input (it's not in the sips argv; pull from args).
        const inputArg = args.input as string;
        const inputResolved = path.resolve(process.cwd(), inputArg);
        fs.copyFileSync(inputResolved, outPath);
        runSipsArgv(plan.argv);
        const stats = fs.statSync(outPath);
        return `Resized → ${outPath} (${(stats.size / 1024).toFixed(1)}KB)`;
      }
      runMagickArgv(plan.argv);
      const outPath = plan.argv[plan.argv.length - 1];
      const stats = fs.statSync(outPath);
      const geometry = plan.argv[plan.argv.indexOf('-resize') + 1];
      return `Resized to ${geometry} → ${outPath} (${(stats.size / 1024).toFixed(1)}KB)`;
    } catch (err: unknown) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // ─── convert ─────────────────────────────────────────────────────────────

  private planConvert(args: Record<string, unknown>, cwd: string): MagickPlan {
    if (typeof args.input !== 'string' || args.input.length === 0) {
      return { error: 'Error: input path is required' };
    }
    const fmt = validateFormat(args.format);
    if ('error' in fmt) return fmt;

    const inRes = resolveInside(cwd, args.input, 'input');
    if ('error' in inRes) return inRes;

    const defOut = defaultOutput(inRes.resolved, '', `.${fmt.ok}`);
    const outPath = typeof args.output === 'string' && args.output.length > 0 ? args.output : defOut;
    const outRes = resolveInside(cwd, outPath, 'output');
    if ('error' in outRes) return outRes;

    let qualityArgs: string[] = [];
    if (args.quality !== undefined && args.quality !== null) {
      const q = validateInt(args.quality, 'quality', 1, 100);
      if ('error' in q) return q;
      qualityArgs = ['-quality', String(q.n)];
    }

    if (hasMagick()) {
      return { backend: 'magick', argv: [inRes.resolved, ...qualityArgs, outRes.resolved] };
    }
    if (os.platform() === 'darwin') {
      // sips maps jpg → jpeg.
      const sipsFmt = fmt.ok === 'jpg' ? 'jpeg' : fmt.ok;
      return { backend: 'sips', argv: ['-s', 'format', sipsFmt, outRes.resolved] };
    }
    return { error: 'Error: ImageMagick not found' };
  }

  private convert(args: Record<string, unknown>): string {
    const plan = this.planConvert(args, process.cwd());
    if ('error' in plan) return plan.error;
    try {
      if (plan.backend === 'sips') {
        const outPath = plan.argv[plan.argv.length - 1];
        const inputResolved = path.resolve(process.cwd(), args.input as string);
        fs.copyFileSync(inputResolved, outPath);
        runSipsArgv(plan.argv);
        const stats = fs.statSync(outPath);
        return `Converted → ${outPath} (${(stats.size / 1024).toFixed(1)}KB)`;
      }
      runMagickArgv(plan.argv);
      const outPath = plan.argv[plan.argv.length - 1];
      const stats = fs.statSync(outPath);
      return `Converted → ${outPath} (${(stats.size / 1024).toFixed(1)}KB)`;
    } catch (err: unknown) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // ─── compress ────────────────────────────────────────────────────────────

  private planCompress(args: Record<string, unknown>, cwd: string): MagickPlan {
    if (typeof args.input !== 'string' || args.input.length === 0) {
      return { error: 'Error: input path is required' };
    }
    const inRes = resolveInside(cwd, args.input, 'input');
    if ('error' in inRes) return inRes;

    const q = validateInt(args.quality ?? 80, 'quality', 1, 100);
    if ('error' in q) return q;

    const defOut = defaultOutput(inRes.resolved, '-compressed');
    const outPath = typeof args.output === 'string' && args.output.length > 0 ? args.output : defOut;
    const outRes = resolveInside(cwd, outPath, 'output');
    if ('error' in outRes) return outRes;

    if (!hasMagick()) return { error: 'Error: ImageMagick not found (needed for compression)' };
    return {
      backend: 'magick',
      argv: [inRes.resolved, '-strip', '-quality', String(q.n), outRes.resolved],
    };
  }

  private compress(args: Record<string, unknown>): string {
    const plan = this.planCompress(args, process.cwd());
    if ('error' in plan) return plan.error;
    try {
      const inputResolved = path.resolve(process.cwd(), args.input as string);
      const beforeSize = fs.statSync(inputResolved).size;
      runMagickArgv(plan.argv);
      const outPath = plan.argv[plan.argv.length - 1];
      const afterSize = fs.statSync(outPath).size;
      const qIdx = plan.argv.indexOf('-quality');
      const quality = qIdx >= 0 ? plan.argv[qIdx + 1] : '?';
      const savings = ((1 - afterSize / beforeSize) * 100).toFixed(1);
      return `Compressed (quality ${quality}) → ${outPath}\n  ${(beforeSize / 1024).toFixed(1)}KB → ${(afterSize / 1024).toFixed(1)}KB (${savings}% smaller)`;
    } catch (err: unknown) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // ─── crop ────────────────────────────────────────────────────────────────

  private planCrop(args: Record<string, unknown>, cwd: string): MagickPlan {
    if (typeof args.input !== 'string' || args.input.length === 0) {
      return { error: 'Error: input path is required' };
    }
    const inRes = resolveInside(cwd, args.input, 'input');
    if ('error' in inRes) return inRes;

    const w = validateInt(args.width, 'width', 1);
    if ('error' in w) return w;
    const h = validateInt(args.height, 'height', 1);
    if ('error' in h) return h;
    const x = validateInt(args.x ?? 0, 'x', 0);
    if ('error' in x) return x;
    const y = validateInt(args.y ?? 0, 'y', 0);
    if ('error' in y) return y;

    const defOut = defaultOutput(inRes.resolved, '-cropped');
    const outPath = typeof args.output === 'string' && args.output.length > 0 ? args.output : defOut;
    const outRes = resolveInside(cwd, outPath, 'output');
    if ('error' in outRes) return outRes;

    if (hasMagick()) {
      const geom = `${w.n}x${h.n}+${x.n}+${y.n}`;
      return { backend: 'magick', argv: [inRes.resolved, '-crop', geom, '+repage', outRes.resolved] };
    }
    if (os.platform() === 'darwin') {
      return {
        backend: 'sips',
        argv: ['-c', String(h.n), String(w.n), '--cropOffset', String(y.n), String(x.n), outRes.resolved],
      };
    }
    return { error: 'Error: ImageMagick not found' };
  }

  private crop(args: Record<string, unknown>): string {
    const plan = this.planCrop(args, process.cwd());
    if ('error' in plan) return plan.error;
    try {
      if (plan.backend === 'sips') {
        const outPath = plan.argv[plan.argv.length - 1];
        const inputResolved = path.resolve(process.cwd(), args.input as string);
        fs.copyFileSync(inputResolved, outPath);
        runSipsArgv(plan.argv);
        return `Cropped → ${outPath}`;
      }
      runMagickArgv(plan.argv);
      const outPath = plan.argv[plan.argv.length - 1];
      const geom = plan.argv[plan.argv.indexOf('-crop') + 1];
      return `Cropped ${geom} → ${outPath}`;
    } catch (err: unknown) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // ─── watermark ───────────────────────────────────────────────────────────

  private planWatermark(args: Record<string, unknown>, cwd: string): MagickPlan {
    if (typeof args.input !== 'string' || args.input.length === 0) {
      return { error: 'Error: input is required' };
    }
    if (typeof args.text !== 'string' || args.text.length === 0) {
      return { error: 'Error: text is required' };
    }
    if (!hasMagick()) return { error: 'Error: ImageMagick not found (needed for watermark)' };

    const inRes = resolveInside(cwd, args.input, 'input');
    if ('error' in inRes) return inRes;

    const defOut = defaultOutput(inRes.resolved, '-watermarked');
    const outPath = typeof args.output === 'string' && args.output.length > 0 ? args.output : defOut;
    const outRes = resolveInside(cwd, outPath, 'output');
    if ('error' in outRes) return outRes;

    const position = typeof args.position === 'string' ? args.position : 'bottom-right';
    const gravityMap: Record<string, string> = {
      'center': 'Center', 'top-left': 'NorthWest', 'top-right': 'NorthEast',
      'bottom-left': 'SouthWest', 'bottom-right': 'SouthEast',
    };
    const gravity = gravityMap[position] ?? 'SouthEast';

    // `text` is one argv element. Magick `-annotate` consumes it as the
    // literal annotation string; shell metacharacters inside never reach
    // any shell.
    return {
      backend: 'magick',
      argv: [
        inRes.resolved,
        '-gravity', gravity,
        '-fill', 'rgba(255,255,255,0.5)',
        '-pointsize', '24',
        '-annotate', '+10+10', args.text,
        outRes.resolved,
      ],
    };
  }

  private watermark(args: Record<string, unknown>): string {
    const plan = this.planWatermark(args, process.cwd());
    if ('error' in plan) return plan.error;
    try {
      runMagickArgv(plan.argv);
      const outPath = plan.argv[plan.argv.length - 1];
      const gravity = plan.argv[plan.argv.indexOf('-gravity') + 1];
      return `Watermarked (${gravity}) → ${outPath}`;
    } catch (err: unknown) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // ─── info ────────────────────────────────────────────────────────────────

  private planInfo(args: Record<string, unknown>, cwd: string): MagickPlan {
    if (typeof args.input !== 'string' || args.input.length === 0) {
      return { error: 'Error: input path is required' };
    }
    const inRes = resolveInside(cwd, args.input, 'input');
    if ('error' in inRes) return inRes;

    if (hasMagick()) {
      return { backend: 'magick', argv: ['identify', '-verbose', inRes.resolved] };
    }
    if (os.platform() === 'darwin') {
      return {
        backend: 'sips',
        argv: ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'format', inRes.resolved],
      };
    }
    return { error: 'Error: no image introspection tool available (install ImageMagick)' };
  }

  private info(args: Record<string, unknown>): string {
    // `info` wants filesystem metadata even if magick/sips aren't installed.
    // We still validate & contain the path via the plan.
    const plan = this.planInfo(args, process.cwd());
    if ('error' in plan) return plan.error;
    const inputResolved = plan.argv[plan.argv.length - 1];
    if (!fs.existsSync(inputResolved)) return `Error: file not found: ${inputResolved}`;

    const stats = fs.statSync(inputResolved);
    const ext = path.extname(inputResolved).toLowerCase();
    let details = `File: ${inputResolved}\n  Size: ${(stats.size / 1024).toFixed(1)}KB\n  Format: ${ext.slice(1)}`;

    try {
      let raw: string;
      if (plan.backend === 'magick') {
        raw = runMagickArgv(plan.argv);
      } else {
        raw = runSipsArgv(plan.argv);
      }
      // Row 12 note: the old code piped through `| head -20` via a shell.
      // Replaced with JS slicing — no shell dependency.
      const truncated = raw.split('\n').slice(0, 20).join('\n');
      details += `\n  ${truncated}`;
    } catch { /* info unavailable */ }

    return details;
  }

  // ─── svg ─────────────────────────────────────────────────────────────────

  private svg(args: Record<string, unknown>): string {
    const cwd = process.cwd();
    const svgContent = args.svg_content;
    const svgType = args.svg_type;
    const outputArg = args.output;

    if (typeof svgContent === 'string' && svgContent.length > 0) {
      if (typeof outputArg !== 'string' || outputArg.length === 0) {
        return 'Error: output path is required when providing svg_content';
      }
      const outRes = resolveInside(cwd, outputArg, 'output');
      if ('error' in outRes) return outRes.error;
      ensureDir(path.dirname(outRes.resolved));
      fs.writeFileSync(outRes.resolved, svgContent);
      return `SVG saved to: ${outRes.resolved}`;
    }

    if (typeof svgType !== 'string' || svgType.length === 0) {
      return 'Error: svg_content or svg_type is required';
    }
    if (typeof outputArg !== 'string' || outputArg.length === 0) {
      return 'Error: output path is required';
    }
    const outRes = resolveInside(cwd, outputArg, 'output');
    if ('error' in outRes) return outRes.error;

    // Dimensions
    const w = validateInt(args.width ?? 64, 'width', 1);
    if ('error' in w) return w.error;
    const h = validateInt(args.height ?? 64, 'height', 1);
    if ('error' in h) return h.error;

    // Colors — validated hex, never default-fallback-silently.
    const bg = validateHexColor(args.bg_color ?? '#1a1a2e', 'bg_color');
    if ('error' in bg) return bg.error;
    const accent = validateHexColor(args.accent_color ?? '#6366f1', 'accent_color');
    if ('error' in accent) return accent.error;
    const text = validateHexColor(args.text_color ?? '#ffffff', 'text_color');
    if ('error' in text) return text.error;

    // Text content — XML-escape.
    const label = typeof args.text === 'string' ? escapeXml(args.text) : '';

    let svg = '';
    switch (svgType) {
      case 'icon':
        svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.n} ${h.n}" fill="none">
  <rect width="${w.n}" height="${h.n}" rx="${(w.n * 0.15).toFixed(2)}" fill="${bg.ok}"/>
  <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="${text.ok}" font-family="system-ui" font-size="${(w.n * 0.4).toFixed(2)}" font-weight="bold">${label || '?'}</text>
</svg>`;
        break;

      case 'badge': {
        const badgeText = label || 'v1.0';
        const badgeW = Math.max(80, badgeText.length * 10 + 40);
        svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${badgeW}" height="28" fill="none">
  <rect width="100%" height="100%" rx="4" fill="${bg.ok}"/>
  <rect x="50%" width="50%" height="100%" rx="0" fill="${accent.ok}"/>
  <rect width="100%" height="100%" rx="4" fill="none" stroke="${accent.ok}" stroke-width="0"/>
  <text x="25%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="${text.ok}" font-family="monospace" font-size="12">CodeBot</text>
  <text x="75%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="${text.ok}" font-family="monospace" font-size="12" font-weight="bold">${badgeText}</text>
</svg>`;
        break;
      }

      case 'pattern':
        svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.n} ${h.n}" fill="none">
  <defs>
    <pattern id="p" width="20" height="20" patternUnits="userSpaceOnUse">
      <circle cx="10" cy="10" r="2" fill="${accent.ok}" opacity="0.3"/>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="${bg.ok}"/>
  <rect width="100%" height="100%" fill="url(#p)"/>
</svg>`;
        break;

      case 'logo':
        svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.n} ${h.n}" fill="none">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="${accent.ok}"/>
      <stop offset="1" stop-color="${bg.ok}"/>
    </linearGradient>
  </defs>
  <circle cx="${(w.n / 2).toFixed(2)}" cy="${(h.n / 2).toFixed(2)}" r="${(Math.min(w.n, h.n) * 0.4).toFixed(2)}" fill="url(#g)"/>
  <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="${text.ok}" font-family="system-ui" font-size="${(w.n * 0.25).toFixed(2)}" font-weight="bold">${label || 'CB'}</text>
</svg>`;
        break;

      default:
        return `Error: unknown svg_type "${svgType}". Available: icon, badge, pattern, logo`;
    }

    ensureDir(path.dirname(outRes.resolved));
    fs.writeFileSync(outRes.resolved, svg);
    return `SVG (${svgType}) saved to: ${outRes.resolved}`;
  }

  // ─── favicon ─────────────────────────────────────────────────────────────

  private favicon(args: Record<string, unknown>): string {
    const cwd = process.cwd();
    if (typeof args.input !== 'string' || args.input.length === 0) {
      return 'Error: input path (source image or SVG) is required';
    }
    const inRes = resolveInside(cwd, args.input, 'input');
    if ('error' in inRes) return inRes.error;
    if (!fs.existsSync(inRes.resolved)) return `Error: file not found: ${inRes.resolved}`;

    const outputDirArg = typeof args.output === 'string' && args.output.length > 0
      ? args.output
      : path.dirname(inRes.resolved);
    const outDirRes = resolveInside(cwd, outputDirArg, 'output');
    if ('error' in outDirRes) return outDirRes.error;
    const outputDir = outDirRes.resolved;

    const sizesStr = typeof args.sizes === 'string' ? args.sizes : '16,32,48,64,128,256';
    const sizes: number[] = [];
    for (const raw of sizesStr.split(',')) {
      const v = validateInt(raw.trim(), 'sizes entry', 1, 2048);
      if ('error' in v) return v.error;
      sizes.push(v.n);
    }

    ensureDir(outputDir);
    const results: string[] = [];

    if (inRes.resolved.endsWith('.svg')) {
      const svgDest = path.join(outputDir, 'favicon.svg');
      fs.copyFileSync(inRes.resolved, svgDest);
      results.push(`  ${svgDest} (SVG)`);

      if (hasMagick()) {
        for (const size of sizes) {
          const pngPath = path.join(outputDir, `favicon-${size}x${size}.png`);
          try {
            runMagickArgv([
              '-background', 'none', '-density', '300',
              inRes.resolved,
              '-resize', `${size}x${size}`,
              pngPath,
            ]);
            results.push(`  ${pngPath} (${size}x${size})`);
          } catch { /* skip failed sizes */ }
        }
        const icoSources = [16, 32, 48]
          .map(s => path.join(outputDir, `favicon-${s}x${s}.png`))
          .filter(f => fs.existsSync(f));
        if (icoSources.length) {
          const icoPath = path.join(outputDir, 'favicon.ico');
          try {
            runMagickArgv([...icoSources, icoPath]);
            results.push(`  ${icoPath} (ICO)`);
          } catch { /* ico generation failed */ }
        }
      }
      return `Favicon set generated:\n${results.join('\n')}`;
    }

    // Raster input
    if (!hasMagick() && os.platform() !== 'darwin') {
      return 'Error: ImageMagick not found (needed to generate favicon set from raster image)';
    }

    for (const size of sizes) {
      const pngPath = path.join(outputDir, `favicon-${size}x${size}.png`);
      try {
        if (hasMagick()) {
          runMagickArgv([inRes.resolved, '-resize', `${size}x${size}`, pngPath]);
        } else {
          fs.copyFileSync(inRes.resolved, pngPath);
          runSipsArgv(['-z', String(size), String(size), pngPath]);
        }
        results.push(`  ${pngPath} (${size}x${size})`);
      } catch { /* skip failed sizes */ }
    }

    if (hasMagick()) {
      const icoSources = [16, 32, 48]
        .map(s => path.join(outputDir, `favicon-${s}x${s}.png`))
        .filter(f => fs.existsSync(f));
      if (icoSources.length) {
        const icoPath = path.join(outputDir, 'favicon.ico');
        try {
          runMagickArgv([...icoSources, icoPath]);
          results.push(`  ${icoPath} (ICO)`);
        } catch { /* ico failed */ }
      }
    }

    return results.length
      ? `Favicon set generated:\n${results.join('\n')}`
      : 'Error: failed to generate any favicon sizes';
  }

  // ─── og_image ────────────────────────────────────────────────────────────

  /**
   * OG image PNG conversion plan. SVG assembly itself has no exec step —
   * only the optional PNG rasterization does. Used by tests.
   */
  private planOgImagePng(args: Record<string, unknown>, cwd: string): MagickPlan {
    const outputArg = typeof args.output === 'string' && args.output.length > 0
      ? args.output
      : path.join(cwd, 'og-image.svg');
    const outRes = resolveInside(cwd, outputArg, 'output');
    if ('error' in outRes) return outRes;
    if (!outRes.resolved.endsWith('.svg')) {
      return { error: 'Error: og_image PNG conversion requires .svg output path' };
    }
    if (!hasMagick()) return { error: 'Error: ImageMagick not found' };
    const pngPath = outRes.resolved.replace(/\.svg$/, '.png');
    return {
      backend: 'magick',
      argv: ['-background', 'none', '-density', '150', outRes.resolved, '-resize', '1200x630!', pngPath],
    };
  }

  private ogImage(args: Record<string, unknown>): string {
    const cwd = process.cwd();
    const title = typeof args.title === 'string' ? args.title : 'Untitled';
    const subtitle = typeof args.subtitle === 'string' ? args.subtitle : '';

    const bg = validateHexColor(args.bg_color ?? '#0f172a', 'bg_color');
    if ('error' in bg) return bg.error;
    const text = validateHexColor(args.text_color ?? '#f8fafc', 'text_color');
    if ('error' in text) return text.error;
    const accent = validateHexColor(args.accent_color ?? '#6366f1', 'accent_color');
    if ('error' in accent) return accent.error;

    const outputArg = typeof args.output === 'string' && args.output.length > 0
      ? args.output
      : path.join(cwd, 'og-image.svg');
    const outRes = resolveInside(cwd, outputArg, 'output');
    if ('error' in outRes) return outRes.error;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" fill="none">
  <rect width="1200" height="630" fill="${bg.ok}"/>
  <rect x="0" y="610" width="1200" height="20" fill="${accent.ok}"/>
  <rect x="60" y="60" width="8" height="510" rx="4" fill="${accent.ok}"/>
  <text x="100" y="280" fill="${text.ok}" font-family="system-ui, -apple-system, sans-serif" font-size="56" font-weight="bold">${escapeXml(title.substring(0, 50))}</text>
  ${subtitle ? `<text x="100" y="350" fill="${text.ok}" font-family="system-ui, -apple-system, sans-serif" font-size="28" opacity="0.7">${escapeXml(subtitle.substring(0, 80))}</text>` : ''}
  <text x="100" y="520" fill="${accent.ok}" font-family="monospace" font-size="20" opacity="0.8">CodeBot AI</text>
</svg>`;

    ensureDir(path.dirname(outRes.resolved));
    fs.writeFileSync(outRes.resolved, svg);

    let pngNote = '';
    if (hasMagick() && outRes.resolved.endsWith('.svg')) {
      const pngPath = outRes.resolved.replace(/\.svg$/, '.png');
      try {
        runMagickArgv([
          '-background', 'none', '-density', '150',
          outRes.resolved,
          '-resize', '1200x630!',
          pngPath,
        ]);
        pngNote = `\n  PNG: ${pngPath}`;
      } catch { /* png conversion failed */ }
    }

    return `OG image generated:\n  SVG: ${outRes.resolved}${pngNote}\n  Dimensions: 1200x630 (standard Open Graph)`;
  }

  // ─── combine ─────────────────────────────────────────────────────────────

  private planCombine(args: Record<string, unknown>, cwd: string): MagickPlan {
    if (typeof args.inputs !== 'string' || args.inputs.length === 0) {
      return { error: 'Error: inputs is required (comma-separated file paths)' };
    }
    if (!hasMagick()) return { error: 'Error: ImageMagick not found (needed for combine)' };

    const rawInputs = args.inputs.split(',').map(s => s.trim()).filter(Boolean);
    if (rawInputs.length === 0) return { error: 'Error: inputs must contain at least one path' };

    const resolved: string[] = [];
    for (const f of rawInputs) {
      const r = resolveInside(cwd, f, 'input');
      if ('error' in r) return r;
      resolved.push(r.resolved);
    }

    const direction = typeof args.direction === 'string' ? args.direction : 'horizontal';
    if (!['horizontal', 'vertical', 'grid'].includes(direction)) {
      return { error: `Error: unknown direction "${direction}". Use: horizontal, vertical, grid` };
    }

    const outputArg = typeof args.output === 'string' && args.output.length > 0
      ? args.output
      : path.join(cwd, `combined-${Date.now()}.png`);
    const outRes = resolveInside(cwd, outputArg, 'output');
    if ('error' in outRes) return outRes;

    if (direction === 'horizontal') {
      return { backend: 'magick', argv: [...resolved, '+append', outRes.resolved] };
    }
    if (direction === 'vertical') {
      return { backend: 'magick', argv: [...resolved, '-append', outRes.resolved] };
    }
    // grid — use `montage` as the first argv element. Magick dispatches to
    // the montage tool internally when invoked this way.
    const cols = Math.ceil(Math.sqrt(resolved.length));
    return {
      backend: 'magick',
      argv: ['montage', ...resolved, '-geometry', '+2+2', '-tile', `${cols}x`, outRes.resolved],
    };
  }

  private combine(args: Record<string, unknown>): string {
    const plan = this.planCombine(args, process.cwd());
    if ('error' in plan) return plan.error;
    try {
      // Verify each input file exists (containment already done in the plan).
      for (const el of plan.argv) {
        // Only check elements that look like paths (skip the magick flags).
        if (el.startsWith('+') || el.startsWith('-') || el === 'montage') continue;
        // Skip tile spec / the output (last).
        if (/^\d+x$/.test(el)) continue;
      }
      runMagickArgv(plan.argv);
      const outPath = plan.argv[plan.argv.length - 1];
      const direction = typeof args.direction === 'string' ? args.direction : 'horizontal';
      // Count inputs: argv length minus known flag count.
      const countGuess = plan.argv.filter(a =>
        !a.startsWith('+') && !a.startsWith('-') && a !== 'montage' && !/^\d+x$/.test(a)
      ).length - 1; // minus the output
      return `Combined ${countGuess} images (${direction}) → ${outPath}`;
    } catch (err: unknown) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}
