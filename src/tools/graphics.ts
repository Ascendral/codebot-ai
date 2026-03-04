/**
 * Graphics Tool — Image processing, SVG generation & asset creation
 *
 * Uses ImageMagick (convert/magick) when available for raster operations.
 * SVG generation and favicon creation work without external dependencies.
 *
 * Actions: resize, convert, compress, crop, watermark, info,
 *          svg, favicon, og_image, sprite, combine
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { Tool } from '../types';

/** Check if ImageMagick is available */
function hasMagick(): boolean {
  try {
    execSync('magick --version 2>/dev/null || convert --version 2>/dev/null', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Get the ImageMagick command name */
function magickCmd(): string {
  try {
    execSync('magick --version', { stdio: 'pipe' });
    return 'magick';
  } catch {
    return 'convert';
  }
}

/** Run an ImageMagick command, return stdout or error */
function runMagick(args: string): string {
  try {
    return execSync(`${magickCmd()} ${args}`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    }).toString().trim();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`ImageMagick error: ${msg.substring(0, 200)}`);
  }
}

/** Run sips (macOS built-in) as fallback */
function runSips(args: string): string {
  try {
    return execSync(`sips ${args}`, {
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
      input: { type: 'string', description: 'Input image path' },
      output: { type: 'string', description: 'Output path (auto-generated if omitted)' },
      width: { type: 'number', description: 'Target width in pixels' },
      height: { type: 'number', description: 'Target height in pixels' },
      format: { type: 'string', description: 'Output format: png, jpg, webp, gif, svg, ico' },
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

  private resize(args: Record<string, unknown>): string {
    const input = args.input as string;
    if (!input) return 'Error: input path is required';
    if (!fs.existsSync(input)) return `Error: file not found: ${input}`;

    const width = args.width as number;
    const height = args.height as number;
    if (!width && !height) return 'Error: width or height is required';

    const ext = path.extname(input);
    const output = (args.output as string) || input.replace(ext, `-${width || ''}x${height || ''}${ext}`);
    const geometry = width && height ? `${width}x${height}!` : width ? `${width}x` : `x${height}`;

    try {
      if (hasMagick()) {
        runMagick(`"${input}" -resize ${geometry} "${output}"`);
      } else if (os.platform() === 'darwin') {
        // macOS sips fallback
        const sipsArgs = width && height
          ? `-z ${height} ${width}`
          : width ? `--resampleWidth ${width}` : `--resampleHeight ${height}`;
        // sips modifies in-place, so copy first
        fs.copyFileSync(input, output);
        runSips(`${sipsArgs} "${output}"`);
      } else {
        return 'Error: ImageMagick not found. Install with: brew install imagemagick (macOS) or apt install imagemagick (Linux)';
      }
      const stats = fs.statSync(output);
      return `Resized to ${geometry} → ${output} (${(stats.size / 1024).toFixed(1)}KB)`;
    } catch (err: unknown) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private convert(args: Record<string, unknown>): string {
    const input = args.input as string;
    const format = args.format as string;
    if (!input) return 'Error: input path is required';
    if (!format) return 'Error: format is required (png, jpg, webp, gif)';
    if (!fs.existsSync(input)) return `Error: file not found: ${input}`;

    const ext = path.extname(input);
    const output = (args.output as string) || input.replace(ext, `.${format}`);

    try {
      if (hasMagick()) {
        const quality = args.quality ? `-quality ${args.quality}` : '';
        runMagick(`"${input}" ${quality} "${output}"`);
      } else if (os.platform() === 'darwin') {
        fs.copyFileSync(input, output);
        runSips(`-s format ${format === 'jpg' ? 'jpeg' : format} "${output}"`);
      } else {
        return 'Error: ImageMagick not found';
      }
      const stats = fs.statSync(output);
      return `Converted to ${format} → ${output} (${(stats.size / 1024).toFixed(1)}KB)`;
    } catch (err: unknown) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private compress(args: Record<string, unknown>): string {
    const input = args.input as string;
    if (!input) return 'Error: input path is required';
    if (!fs.existsSync(input)) return `Error: file not found: ${input}`;

    const quality = (args.quality as number) || 80;
    const ext = path.extname(input);
    const output = (args.output as string) || input.replace(ext, `-compressed${ext}`);
    const beforeSize = fs.statSync(input).size;

    try {
      if (hasMagick()) {
        runMagick(`"${input}" -strip -quality ${quality} "${output}"`);
      } else {
        return 'Error: ImageMagick not found (needed for compression)';
      }
      const afterSize = fs.statSync(output).size;
      const savings = ((1 - afterSize / beforeSize) * 100).toFixed(1);
      return `Compressed (quality ${quality}) → ${output}\n  ${(beforeSize / 1024).toFixed(1)}KB → ${(afterSize / 1024).toFixed(1)}KB (${savings}% smaller)`;
    } catch (err: unknown) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private crop(args: Record<string, unknown>): string {
    const input = args.input as string;
    if (!input) return 'Error: input path is required';
    if (!fs.existsSync(input)) return `Error: file not found: ${input}`;

    const width = args.width as number;
    const height = args.height as number;
    if (!width || !height) return 'Error: width and height are required for crop';

    const x = (args.x as number) || 0;
    const y = (args.y as number) || 0;
    const ext = path.extname(input);
    const output = (args.output as string) || input.replace(ext, `-cropped${ext}`);

    try {
      if (hasMagick()) {
        runMagick(`"${input}" -crop ${width}x${height}+${x}+${y} +repage "${output}"`);
      } else if (os.platform() === 'darwin') {
        fs.copyFileSync(input, output);
        runSips(`-c ${height} ${width} --cropOffset ${y} ${x} "${output}"`);
      } else {
        return 'Error: ImageMagick not found';
      }
      return `Cropped ${width}x${height}+${x}+${y} → ${output}`;
    } catch (err: unknown) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private watermark(args: Record<string, unknown>): string {
    const input = args.input as string;
    const text = args.text as string;
    if (!input || !text) return 'Error: input and text are required';
    if (!fs.existsSync(input)) return `Error: file not found: ${input}`;
    if (!hasMagick()) return 'Error: ImageMagick not found (needed for watermark)';

    const position = (args.position as string) || 'bottom-right';
    const ext = path.extname(input);
    const output = (args.output as string) || input.replace(ext, `-watermarked${ext}`);

    const gravityMap: Record<string, string> = {
      'center': 'Center', 'top-left': 'NorthWest', 'top-right': 'NorthEast',
      'bottom-left': 'SouthWest', 'bottom-right': 'SouthEast',
    };
    const gravity = gravityMap[position] || 'SouthEast';

    try {
      runMagick(`"${input}" -gravity ${gravity} -fill "rgba(255,255,255,0.5)" -pointsize 24 -annotate +10+10 "${text}" "${output}"`);
      return `Watermarked (${position}) → ${output}`;
    } catch (err: unknown) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private info(args: Record<string, unknown>): string {
    const input = args.input as string;
    if (!input) return 'Error: input path is required';
    if (!fs.existsSync(input)) return `Error: file not found: ${input}`;

    const stats = fs.statSync(input);
    const ext = path.extname(input).toLowerCase();
    let details = `File: ${input}\n  Size: ${(stats.size / 1024).toFixed(1)}KB\n  Format: ${ext.slice(1)}`;

    try {
      if (hasMagick()) {
        const info = runMagick(`identify -verbose "${input}" 2>/dev/null | head -20`);
        details += `\n  ${info}`;
      } else if (os.platform() === 'darwin') {
        const info = runSips(`-g pixelWidth -g pixelHeight -g format "${input}"`);
        details += `\n  ${info}`;
      }
    } catch { /* info unavailable */ }

    return details;
  }

  private svg(args: Record<string, unknown>): string {
    const svgContent = args.svg_content as string;
    const svgType = args.svg_type as string;
    const output = args.output as string;

    if (svgContent) {
      // Direct SVG content
      if (!output) return 'Error: output path is required when providing svg_content';
      ensureDir(path.dirname(output));
      fs.writeFileSync(output, svgContent);
      return `SVG saved to: ${output}`;
    }

    if (!svgType) return 'Error: svg_content or svg_type is required';
    if (!output) return 'Error: output path is required';

    const width = (args.width as number) || 64;
    const height = (args.height as number) || 64;
    const bgColor = (args.bg_color as string) || '#1a1a2e';
    const accentColor = (args.accent_color as string) || '#6366f1';
    const textColor = (args.text_color as string) || '#ffffff';
    const text = (args.text as string) || '';

    let svg = '';

    switch (svgType) {
      case 'icon':
        svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" fill="none">
  <rect width="${width}" height="${height}" rx="${width * 0.15}" fill="${bgColor}"/>
  <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="${textColor}" font-family="system-ui" font-size="${width * 0.4}" font-weight="bold">${text || '?'}</text>
</svg>`;
        break;

      case 'badge':
        const badgeText = text || 'v1.0';
        svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(80, badgeText.length * 10 + 40)}" height="28" fill="none">
  <rect width="100%" height="100%" rx="4" fill="${bgColor}"/>
  <rect x="50%" width="50%" height="100%" rx="0" fill="${accentColor}"/>
  <rect width="100%" height="100%" rx="4" fill="none" stroke="${accentColor}" stroke-width="0"/>
  <text x="25%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="${textColor}" font-family="monospace" font-size="12">CodeBot</text>
  <text x="75%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="${textColor}" font-family="monospace" font-size="12" font-weight="bold">${badgeText}</text>
</svg>`;
        break;

      case 'pattern':
        svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" fill="none">
  <defs>
    <pattern id="p" width="20" height="20" patternUnits="userSpaceOnUse">
      <circle cx="10" cy="10" r="2" fill="${accentColor}" opacity="0.3"/>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="${bgColor}"/>
  <rect width="100%" height="100%" fill="url(#p)"/>
</svg>`;
        break;

      case 'logo':
        svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" fill="none">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="${accentColor}"/>
      <stop offset="1" stop-color="${bgColor}"/>
    </linearGradient>
  </defs>
  <circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) * 0.4}" fill="url(#g)"/>
  <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="${textColor}" font-family="system-ui" font-size="${width * 0.25}" font-weight="bold">${text || 'CB'}</text>
</svg>`;
        break;

      default:
        return `Error: unknown svg_type "${svgType}". Available: icon, badge, pattern, logo`;
    }

    ensureDir(path.dirname(output));
    fs.writeFileSync(output, svg);
    return `SVG (${svgType}) saved to: ${output}`;
  }

  private favicon(args: Record<string, unknown>): string {
    const input = args.input as string;
    if (!input) return 'Error: input path (source image or SVG) is required';
    if (!fs.existsSync(input)) return `Error: file not found: ${input}`;

    const outputDir = (args.output as string) || path.dirname(input);
    const sizes = ((args.sizes as string) || '16,32,48,64,128,256').split(',').map(s => parseInt(s.trim()));

    ensureDir(outputDir);

    // If input is SVG, just copy as favicon.svg
    if (input.endsWith('.svg')) {
      const svgDest = path.join(outputDir, 'favicon.svg');
      fs.copyFileSync(input, svgDest);
      const results = [`  ${svgDest} (SVG)`];

      // Also generate PNG sizes if ImageMagick available
      if (hasMagick()) {
        for (const size of sizes) {
          const pngPath = path.join(outputDir, `favicon-${size}x${size}.png`);
          try {
            runMagick(`-background none -density 300 "${input}" -resize ${size}x${size} "${pngPath}"`);
            results.push(`  ${pngPath} (${size}x${size})`);
          } catch { /* skip failed sizes */ }
        }

        // Generate .ico (16 + 32 + 48)
        const icoSources = [16, 32, 48].map(s => path.join(outputDir, `favicon-${s}x${s}.png`)).filter(f => fs.existsSync(f));
        if (icoSources.length) {
          const icoPath = path.join(outputDir, 'favicon.ico');
          try {
            runMagick(`${icoSources.map(f => `"${f}"`).join(' ')} "${icoPath}"`);
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

    const results: string[] = [];
    for (const size of sizes) {
      const pngPath = path.join(outputDir, `favicon-${size}x${size}.png`);
      try {
        if (hasMagick()) {
          runMagick(`"${input}" -resize ${size}x${size} "${pngPath}"`);
        } else {
          fs.copyFileSync(input, pngPath);
          runSips(`-z ${size} ${size} "${pngPath}"`);
        }
        results.push(`  ${pngPath} (${size}x${size})`);
      } catch { /* skip failed sizes */ }
    }

    // Generate .ico
    if (hasMagick()) {
      const icoSources = [16, 32, 48].map(s => path.join(outputDir, `favicon-${s}x${s}.png`)).filter(f => fs.existsSync(f));
      if (icoSources.length) {
        const icoPath = path.join(outputDir, 'favicon.ico');
        try {
          runMagick(`${icoSources.map(f => `"${f}"`).join(' ')} "${icoPath}"`);
          results.push(`  ${icoPath} (ICO)`);
        } catch { /* ico failed */ }
      }
    }

    return results.length
      ? `Favicon set generated:\n${results.join('\n')}`
      : 'Error: failed to generate any favicon sizes';
  }

  private ogImage(args: Record<string, unknown>): string {
    const title = (args.title as string) || 'Untitled';
    const subtitle = (args.subtitle as string) || '';
    const bgColor = (args.bg_color as string) || '#0f172a';
    const textColor = (args.text_color as string) || '#f8fafc';
    const accentColor = (args.accent_color as string) || '#6366f1';
    const output = (args.output as string) || path.join(process.cwd(), 'og-image.svg');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" fill="none">
  <rect width="1200" height="630" fill="${bgColor}"/>
  <rect x="0" y="610" width="1200" height="20" fill="${accentColor}"/>
  <rect x="60" y="60" width="8" height="510" rx="4" fill="${accentColor}"/>
  <text x="100" y="280" fill="${textColor}" font-family="system-ui, -apple-system, sans-serif" font-size="56" font-weight="bold">${escapeXml(title.substring(0, 50))}</text>
  ${subtitle ? `<text x="100" y="350" fill="${textColor}" font-family="system-ui, -apple-system, sans-serif" font-size="28" opacity="0.7">${escapeXml(subtitle.substring(0, 80))}</text>` : ''}
  <text x="100" y="520" fill="${accentColor}" font-family="monospace" font-size="20" opacity="0.8">CodeBot AI</text>
</svg>`;

    ensureDir(path.dirname(output));
    fs.writeFileSync(output, svg);

    // Also generate PNG version if ImageMagick available
    let pngNote = '';
    if (hasMagick() && output.endsWith('.svg')) {
      const pngPath = output.replace('.svg', '.png');
      try {
        runMagick(`-background none -density 150 "${output}" -resize 1200x630! "${pngPath}"`);
        pngNote = `\n  PNG: ${pngPath}`;
      } catch { /* png conversion failed */ }
    }

    return `OG image generated:\n  SVG: ${output}${pngNote}\n  Dimensions: 1200x630 (standard Open Graph)`;
  }

  private combine(args: Record<string, unknown>): string {
    const inputsStr = args.inputs as string;
    if (!inputsStr) return 'Error: inputs is required (comma-separated file paths)';
    if (!hasMagick()) return 'Error: ImageMagick not found (needed for combine)';

    const inputs = inputsStr.split(',').map(s => s.trim()).filter(Boolean);
    for (const f of inputs) {
      if (!fs.existsSync(f)) return `Error: file not found: ${f}`;
    }

    const direction = (args.direction as string) || 'horizontal';
    const output = (args.output as string) || path.join(process.cwd(), `combined-${Date.now()}.png`);

    try {
      const quoted = inputs.map(f => `"${f}"`).join(' ');
      if (direction === 'horizontal') {
        runMagick(`${quoted} +append "${output}"`);
      } else if (direction === 'vertical') {
        runMagick(`${quoted} -append "${output}"`);
      } else if (direction === 'grid') {
        const cols = Math.ceil(Math.sqrt(inputs.length));
        runMagick(`montage ${quoted} -geometry +2+2 -tile ${cols}x "${output}"`);
      } else {
        return `Error: unknown direction "${direction}". Use: horizontal, vertical, grid`;
      }
      return `Combined ${inputs.length} images (${direction}) → ${output}`;
    } catch (err: unknown) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
