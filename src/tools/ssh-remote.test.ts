import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { SshRemoteTool } from './ssh-remote';

/**
 * SshRemoteTool tests — validates host injection blocking, input validation,
 * action routing, metadata, and error messages.
 * Tests do NOT require SSH access to any remote server.
 */

describe('SshRemoteTool — metadata', () => {
  const tool = new SshRemoteTool();

  it('has correct tool name', () => {
    assert.strictEqual(tool.name, 'ssh_remote');
  });

  it('has always-ask permission level (highest security)', () => {
    assert.strictEqual(tool.permission, 'always-ask');
  });

  it('requires action and host parameters', () => {
    const required = tool.parameters.required as string[];
    assert.ok(required.includes('action'));
    assert.ok(required.includes('host'));
  });

  it('has description mentioning SSH and SCP', () => {
    assert.ok(tool.description.includes('SSH'));
    assert.ok(tool.description.includes('SCP'));
  });
});

describe('SshRemoteTool — input validation', () => {
  const tool = new SshRemoteTool();

  it('returns error when action is missing', async () => {
    const result = await tool.execute({ host: 'example.com' });
    assert.ok(result.includes('Error: action is required'));
  });

  it('returns error when host is missing', async () => {
    const result = await tool.execute({ action: 'exec' });
    assert.ok(result.includes('Error: host is required'));
  });

  it('returns error for unknown action', async () => {
    const result = await tool.execute({ action: 'hack', host: 'example.com' });
    assert.ok(result.includes('Error: unknown action'));
    assert.ok(result.includes('hack'));
    assert.ok(result.includes('exec, upload, download'));
  });

  it('returns error when command is missing for exec action', async () => {
    const result = await tool.execute({ action: 'exec', host: 'example.com' });
    assert.ok(result.includes('Error: command is required for exec'));
  });

  it('returns error when paths are missing for upload action', async () => {
    const result = await tool.execute({
      action: 'upload',
      host: 'example.com',
    });
    assert.ok(result.includes('Error: local_path and remote_path are required'));
  });

  it('returns error when paths are missing for download action', async () => {
    const result = await tool.execute({
      action: 'download',
      host: 'example.com',
    });
    assert.ok(result.includes('Error: local_path and remote_path are required'));
  });
});

describe('SshRemoteTool — host injection blocking', () => {
  const tool = new SshRemoteTool();

  it('blocks semicolon injection in host', async () => {
    const result = await tool.execute({
      action: 'exec',
      host: 'example.com; rm -rf /',
      command: 'ls',
    });
    assert.ok(result.includes('Error: host contains invalid characters'));
    assert.ok(result.includes('injection'));
  });

  it('blocks pipe injection in host', async () => {
    const result = await tool.execute({
      action: 'exec',
      host: 'example.com | cat /etc/passwd',
      command: 'ls',
    });
    assert.ok(result.includes('Error: host contains invalid characters'));
  });

  it('blocks backtick injection in host', async () => {
    const result = await tool.execute({
      action: 'exec',
      host: 'example.com`whoami`',
      command: 'ls',
    });
    assert.ok(result.includes('Error: host contains invalid characters'));
  });

  it('blocks dollar sign injection in host', async () => {
    const result = await tool.execute({
      action: 'exec',
      host: 'example.com$(whoami)',
      command: 'ls',
    });
    assert.ok(result.includes('Error: host contains invalid characters'));
  });

  it('blocks ampersand injection in host', async () => {
    const result = await tool.execute({
      action: 'exec',
      host: 'example.com && rm -rf /',
      command: 'ls',
    });
    assert.ok(result.includes('Error: host contains invalid characters'));
  });

  it('blocks single quote injection in host', async () => {
    const result = await tool.execute({
      action: 'exec',
      host: "example.com' ; rm -rf / '",
      command: 'ls',
    });
    assert.ok(result.includes('Error: host contains invalid characters'));
  });

  it('blocks newline injection in host', async () => {
    const result = await tool.execute({
      action: 'exec',
      host: 'example.com\nrm -rf /',
      command: 'ls',
    });
    assert.ok(result.includes('Error: host contains invalid characters'));
  });

  it('allows valid hostname', async () => {
    // This will fail on SSH connection but should pass host validation
    const result = await tool.execute({
      action: 'exec',
      host: 'user@example.com',
      command: 'ls',
    });
    assert.ok(!result.includes('invalid characters'));
  });

  it('allows hostname with port-style colon', async () => {
    const result = await tool.execute({
      action: 'exec',
      host: 'user@example.com:2222',
      command: 'ls',
    });
    assert.ok(!result.includes('invalid characters'));
  });

  it('allows IP address as host', async () => {
    const result = await tool.execute({
      action: 'exec',
      host: '192.168.1.100',
      command: 'ls',
    });
    assert.ok(!result.includes('invalid characters'));
  });

  it('allows hostname with dots and hyphens', async () => {
    const result = await tool.execute({
      action: 'exec',
      host: 'my-server.internal.example.com',
      command: 'ls',
    });
    assert.ok(!result.includes('invalid characters'));
  });
});

describe('SshRemoteTool — command injection via host (regression)', () => {
  const tool = new SshRemoteTool();

  it('blocks space in host (prevents argument injection)', async () => {
    const result = await tool.execute({
      action: 'exec',
      host: '-o ProxyCommand=evil example.com',
      command: 'ls',
    });
    assert.ok(result.includes('Error: host contains invalid characters'));
  });
});
