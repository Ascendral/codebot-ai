import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PluginForgeTool } from './plugin-forge';
import { isPluginSafe } from '../plugins';

describe('isPluginSafe', () => {
  it('allows safe code', () => {
    expect(isPluginSafe('const x = 1 + 2; return String(x);')).toBeNull();
  });

  it('blocks child_process', () => {
    expect(isPluginSafe('const cp = require("child_process")')).toContain('child_process');
  });

  it('blocks eval', () => {
    expect(isPluginSafe('eval("dangerous")')).toContain('eval');
  });

  it('blocks fs access', () => {
    expect(isPluginSafe('const fs = require("fs")')).toContain('fs');
  });

  it('blocks network access', () => {
    expect(isPluginSafe('const net = require("net")')).toContain('net');
  });

  it('blocks process.exit', () => {
    expect(isPluginSafe('process.exit(1)')).toContain('process.exit');
  });

  it('blocks spawn', () => {
    expect(isPluginSafe('spawn("rm", ["-rf", "/"])')).toContain('spawn');
  });
});

describe('PluginForgeTool', () => {
  let tmpDir: string;
  let forge: PluginForgeTool;
  const origEnv = process.env.CODEBOT_HOME;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-forge-'));
    process.env.CODEBOT_HOME = tmpDir;
    forge = new PluginForgeTool();
  });

  afterEach(() => {
    if (origEnv) process.env.CODEBOT_HOME = origEnv;
    else delete process.env.CODEBOT_HOME;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('create', () => {
    it('creates plugin in staging', async () => {
      const result = await forge.execute({
        action: 'create',
        name: 'hello',
        description: 'Says hello',
        code: 'return "Hello, " + (args.name || "world");',
        parameters: { type: 'object', properties: { name: { type: 'string' } }, required: [] },
      });

      expect(result).toContain('created in staging');
      expect(fs.existsSync(path.join(tmpDir, 'plugins', 'staging', 'hello.js'))).toBe(true);
    });

    it('blocks dangerous code', async () => {
      const result = await forge.execute({
        action: 'create',
        name: 'evil',
        code: 'const cp = require("child_process"); cp.execSync("rm -rf /");',
      });
      expect(result).toContain('BLOCKED');
    });

    it('rejects empty name', async () => {
      const result = await forge.execute({ action: 'create', name: '', code: 'return 1' });
      expect(result).toContain('required');
    });

    it('rejects invalid name chars', async () => {
      const result = await forge.execute({ action: 'create', name: 'bad name!', code: 'return 1' });
      expect(result).toContain('must contain only');
    });

    it('generates manifest with hash', async () => {
      await forge.execute({ action: 'create', name: 'hashed', code: 'return 42;' });
      const manifest = JSON.parse(
        fs.readFileSync(path.join(tmpDir, 'plugins', 'staging', 'plugin.json'), 'utf-8'),
      );
      expect(manifest.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    });
  });

  describe('list', () => {
    it('lists active and staging plugins', async () => {
      await forge.execute({ action: 'create', name: 'staged_one', code: 'return 1;' });
      const result = await forge.execute({ action: 'list' });
      expect(result).toContain('staged_one');
    });

    it('shows no plugins when empty', async () => {
      const result = await forge.execute({ action: 'list' });
      expect(result).toContain('No active plugins');
    });
  });

  describe('validate', () => {
    it('passes valid plugin', async () => {
      await forge.execute({ action: 'create', name: 'valid_plug', code: 'return "ok";' });
      const result = await forge.execute({ action: 'validate', name: 'valid_plug' });
      expect(result).toContain('passed all safety checks');
    });

    it('fails non-existent plugin', async () => {
      const result = await forge.execute({ action: 'validate', name: 'nonexistent' });
      expect(result).toContain('not found');
    });
  });

  describe('promote', () => {
    it('moves plugin from staging to active', async () => {
      await forge.execute({ action: 'create', name: 'promote_me', code: 'return "promoted";' });
      const result = await forge.execute({ action: 'promote', name: 'promote_me' });
      expect(result).toContain('promoted');
      expect(fs.existsSync(path.join(tmpDir, 'plugins', 'promote_me.js'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'plugins', 'staging', 'promote_me.js'))).toBe(false);
    });
  });

  describe('remove', () => {
    it('removes plugin from staging', async () => {
      await forge.execute({ action: 'create', name: 'remove_me', code: 'return 1;' });
      const result = await forge.execute({ action: 'remove', name: 'remove_me' });
      expect(result).toContain('removed');
    });

    it('reports not found for missing plugin', async () => {
      const result = await forge.execute({ action: 'remove', name: 'ghost' });
      expect(result).toContain('not found');
    });
  });
});
