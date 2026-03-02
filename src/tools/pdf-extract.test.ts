import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PdfExtractTool } from './pdf-extract';

describe('PdfExtractTool', () => {
  let tool: PdfExtractTool;
  let tmpDir: string;

  before(() => {
    tool = new PdfExtractTool();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-extract-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should have correct tool metadata', () => {
    assert.strictEqual(tool.name, 'pdf_extract');
    assert.strictEqual(tool.permission, 'auto');
  });

  it('should return error when action is missing', async () => {
    const result = await tool.execute({ action: '', path: '/tmp/test.pdf' });
    assert.strictEqual(result, 'Error: action is required');
  });

  it('should return error when path is missing', async () => {
    const result = await tool.execute({ action: 'text', path: '' });
    assert.strictEqual(result, 'Error: path is required');
  });

  it('should return error when file does not exist', async () => {
    const result = await tool.execute({ action: 'text', path: '/nonexistent/file.pdf' });
    assert.match(result, /Error: file not found/);
  });

  it('should return error for non-PDF file extension', async () => {
    const txtFile = path.join(tmpDir, 'notapdf.txt');
    fs.writeFileSync(txtFile, 'hello');

    const result = await tool.execute({ action: 'text', path: txtFile });
    assert.match(result, /Error: not a PDF file/);
    assert.match(result, /\.txt/);
  });

  it('should return error for unknown action', async () => {
    const pdfFile = path.join(tmpDir, 'dummy.pdf');
    fs.writeFileSync(pdfFile, '%PDF-1.4\n');

    const result = await tool.execute({ action: 'foobar', path: pdfFile });
    assert.match(result, /Error: unknown action "foobar"/);
    assert.match(result, /text, info, pages/);
  });

  it('should extract info from a minimal PDF', async () => {
    const pdfFile = path.join(tmpDir, 'info.pdf');
    // Minimal PDF-like content with metadata
    const content = '%PDF-1.4\n/Type /Page\n/Title (Test Document)\n/Author (Test Author)\n%%EOF';
    fs.writeFileSync(pdfFile, content);

    const result = await tool.execute({ action: 'info', path: pdfFile });
    assert.match(result, /File: info\.pdf/);
    assert.match(result, /Size:/);
    assert.match(result, /Pages:/);
    assert.match(result, /Modified:/);
    assert.match(result, /Title: Test Document/);
    assert.match(result, /Author: Test Author/);
  });

  it('should count pages from /Type /Page markers', async () => {
    const pdfFile = path.join(tmpDir, 'pages.pdf');
    // Create content with multiple /Type /Page markers
    const content = '%PDF-1.4\n/Type /Page\n/Type /Page\n/Type /Page\n%%EOF';
    fs.writeFileSync(pdfFile, content);

    const result = await tool.execute({ action: 'pages', path: pdfFile });
    assert.match(result, /pages\.pdf/);
    assert.match(result, /approximately 3 page/);
  });

  it('should not count /Type /Pages as a page', async () => {
    const pdfFile = path.join(tmpDir, 'pagescatalog.pdf');
    const content = '%PDF-1.4\n/Type /Pages\n/Type /Page\n%%EOF';
    fs.writeFileSync(pdfFile, content);

    const result = await tool.execute({ action: 'pages', path: pdfFile });
    assert.match(result, /approximately 1 page/);
  });

  it('should handle text extraction from PDF with no extractable text', async () => {
    const pdfFile = path.join(tmpDir, 'notext.pdf');
    // A PDF that has no BT/ET text blocks
    fs.writeFileSync(pdfFile, '%PDF-1.4\n%%EOF');

    const result = await tool.execute({ action: 'text', path: pdfFile });
    assert.match(result, /No extractable text found/);
  });

  it('should extract text from a PDF with stream content', async () => {
    const pdfFile = path.join(tmpDir, 'withtext.pdf');
    // Create a minimal PDF with a text stream
    const content = '%PDF-1.4\nstream\nBT\n(Hello World) Tj\nET\nendstream\n%%EOF';
    fs.writeFileSync(pdfFile, content);

    const result = await tool.execute({ action: 'text', path: pdfFile });
    assert.match(result, /Hello World/);
  });

  it('should handle TJ array text extraction', async () => {
    const pdfFile = path.join(tmpDir, 'tjarray.pdf');
    const content = '%PDF-1.4\nstream\nBT\n[(Foo) 10 (Bar)] TJ\nET\nendstream\n%%EOF';
    fs.writeFileSync(pdfFile, content);

    const result = await tool.execute({ action: 'text', path: pdfFile });
    assert.match(result, /FooBar/);
  });
});
