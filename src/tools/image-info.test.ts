import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ImageInfoTool } from './image-info';

describe('ImageInfoTool', () => {
  let tool: ImageInfoTool;
  let tmpDir: string;

  before(() => {
    tool = new ImageInfoTool();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-info-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should have correct tool metadata', () => {
    assert.strictEqual(tool.name, 'image_info');
    assert.strictEqual(tool.permission, 'auto');
    assert.strictEqual(tool.cacheable, true);
  });

  it('should return error when path is missing', async () => {
    const result = await tool.execute({ path: '' });
    assert.strictEqual(result, 'Error: path is required');
  });

  it('should return error when file does not exist', async () => {
    const result = await tool.execute({ path: '/nonexistent/image.png' });
    assert.match(result, /Error: file not found/);
  });

  it('should detect PNG format and dimensions from header', async () => {
    const filePath = path.join(tmpDir, 'test.png');
    // Minimal valid PNG header: 8-byte signature + IHDR chunk with width=100, height=50
    const buf = Buffer.alloc(32);
    // PNG signature
    buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4E; buf[3] = 0x47;
    buf[4] = 0x0D; buf[5] = 0x0A; buf[6] = 0x1A; buf[7] = 0x0A;
    // IHDR chunk length (13 bytes)
    buf.writeUInt32BE(13, 8);
    // IHDR signature
    buf[12] = 0x49; buf[13] = 0x48; buf[14] = 0x44; buf[15] = 0x52;
    // Width = 100
    buf.writeUInt32BE(100, 16);
    // Height = 50
    buf.writeUInt32BE(50, 20);
    fs.writeFileSync(filePath, buf);

    const result = await tool.execute({ path: filePath });
    assert.match(result, /Format: PNG/);
    assert.match(result, /Dimensions: 100 x 50/);
    assert.match(result, /File: test\.png/);
    assert.match(result, /Size:/);
    assert.match(result, /Modified:/);
  });

  it('should detect GIF format and dimensions', async () => {
    const filePath = path.join(tmpDir, 'test.gif');
    const buf = Buffer.alloc(32);
    // GIF89a signature
    buf[0] = 0x47; buf[1] = 0x49; buf[2] = 0x46;
    buf[3] = 0x38; buf[4] = 0x39; buf[5] = 0x61;
    // Width = 200 (little-endian)
    buf.writeUInt16LE(200, 6);
    // Height = 150 (little-endian)
    buf.writeUInt16LE(150, 8);
    fs.writeFileSync(filePath, buf);

    const result = await tool.execute({ path: filePath });
    assert.match(result, /Format: GIF/);
    assert.match(result, /Dimensions: 200 x 150/);
  });

  it('should detect BMP format and dimensions', async () => {
    const filePath = path.join(tmpDir, 'test.bmp');
    const buf = Buffer.alloc(32);
    // BMP signature
    buf[0] = 0x42; buf[1] = 0x4D;
    // Width at offset 18 (int32 LE)
    buf.writeInt32LE(320, 18);
    // Height at offset 22 (int32 LE), negative = top-down
    buf.writeInt32LE(-240, 22);
    fs.writeFileSync(filePath, buf);

    const result = await tool.execute({ path: filePath });
    assert.match(result, /Format: BMP/);
    assert.match(result, /Dimensions: 320 x 240/);
  });

  it('should detect SVG format from extension and parse width/height', async () => {
    const filePath = path.join(tmpDir, 'test.svg');
    fs.writeFileSync(filePath, '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"></svg>');

    const result = await tool.execute({ path: filePath });
    assert.match(result, /Format: SVG/);
    assert.match(result, /Dimensions: 400 x 300/);
  });

  it('should parse SVG viewBox when width/height are absent', async () => {
    const filePath = path.join(tmpDir, 'viewbox.svg');
    fs.writeFileSync(filePath, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"></svg>');

    const result = await tool.execute({ path: filePath });
    assert.match(result, /Format: SVG/);
    assert.match(result, /Dimensions: 800 x 600/);
  });

  it('should report unknown format for non-image files', async () => {
    const filePath = path.join(tmpDir, 'text.txt');
    fs.writeFileSync(filePath, 'This is not an image');

    const result = await tool.execute({ path: filePath });
    assert.match(result, /Format: unknown/);
    // Should not include Dimensions line for unknown format
    assert.ok(!result.includes('Dimensions:'));
  });

  it('should report file size in KB', async () => {
    const filePath = path.join(tmpDir, 'sized.png');
    // Write some data
    const buf = Buffer.alloc(2048);
    buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4E; buf[3] = 0x47;
    fs.writeFileSync(filePath, buf);

    const result = await tool.execute({ path: filePath });
    assert.match(result, /Size: 2\.0 KB/);
  });

  it('should include modification date', async () => {
    const filePath = path.join(tmpDir, 'dated.png');
    const buf = Buffer.alloc(32);
    buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4E; buf[3] = 0x47;
    fs.writeFileSync(filePath, buf);

    const result = await tool.execute({ path: filePath });
    assert.match(result, /Modified: \d{4}-\d{2}-\d{2}/);
  });
});
