import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GraphicsTool } from './graphics';

describe('GraphicsTool', () => {
  const tool = new GraphicsTool();
  const tmpDir = path.join(os.tmpdir(), 'codebot-graphics-test-' + Date.now());

  before(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('has correct metadata', () => {
    assert.strictEqual(tool.name, 'graphics');
    assert.strictEqual(tool.permission, 'prompt');
    assert.ok(tool.description.includes('SVG'));
  });

  it('returns error for unknown action', async () => {
    const result = await tool.execute({ action: 'explode' });
    assert.ok(result.includes('Error: unknown action'));
  });

  it('svg action creates SVG icon', async () => {
    const output = path.join(tmpDir, 'test-icon.svg');
    const result = await tool.execute({
      action: 'svg',
      svg_type: 'icon',
      text: 'CB',
      output,
    });
    assert.ok(result.includes('SVG'));
    assert.ok(result.includes(output));
    assert.ok(fs.existsSync(output));
    const content = fs.readFileSync(output, 'utf-8');
    assert.ok(content.includes('<svg'));
    assert.ok(content.includes('CB'));
  });

  it('svg action creates badge', async () => {
    const output = path.join(tmpDir, 'test-badge.svg');
    const result = await tool.execute({
      action: 'svg',
      svg_type: 'badge',
      text: 'v2.5',
      output,
    });
    assert.ok(result.includes('SVG'));
    assert.ok(fs.existsSync(output));
  });

  it('svg action creates logo', async () => {
    const output = path.join(tmpDir, 'test-logo.svg');
    const result = await tool.execute({
      action: 'svg',
      svg_type: 'logo',
      text: 'AI',
      accent_color: '#ff6b6b',
      output,
    });
    assert.ok(result.includes('SVG'));
    assert.ok(fs.existsSync(output));
    const content = fs.readFileSync(output, 'utf-8');
    assert.ok(content.includes('#ff6b6b'));
  });

  it('svg action saves raw SVG content', async () => {
    const output = path.join(tmpDir, 'test-raw.svg');
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>';
    const result = await tool.execute({
      action: 'svg',
      svg_content: svgContent,
      output,
    });
    assert.ok(result.includes('SVG saved'));
    assert.strictEqual(fs.readFileSync(output, 'utf-8'), svgContent);
  });

  it('og_image generates Open Graph image', async () => {
    const output = path.join(tmpDir, 'og.svg');
    const result = await tool.execute({
      action: 'og_image',
      title: 'CodeBot AI',
      subtitle: 'Your autonomous coding assistant',
      output,
    });
    assert.ok(result.includes('OG image'));
    assert.ok(result.includes('1200x630'));
    assert.ok(fs.existsSync(output));
    const content = fs.readFileSync(output, 'utf-8');
    assert.ok(content.includes('CodeBot AI'));
  });

  it('info requires input path', async () => {
    const result = await tool.execute({ action: 'info' });
    assert.ok(result.includes('Error:'));
  });

  it('resize requires input and dimensions', async () => {
    const result = await tool.execute({ action: 'resize', input: '/nonexistent.png' });
    assert.ok(result.includes('Error:'));
  });

  it('convert requires format', async () => {
    const result = await tool.execute({ action: 'convert', input: '/nonexistent.png' });
    assert.ok(result.includes('Error:'));
  });

  it('crop requires width and height', async () => {
    const testFile = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(testFile, 'test');
    const result = await tool.execute({ action: 'crop', input: testFile });
    assert.ok(result.includes('Error:'));
  });
});
