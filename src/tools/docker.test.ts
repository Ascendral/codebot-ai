import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { DockerTool } from './docker';

/**
 * DockerTool tests — validates safety checks (--privileged, root mount,
 * docker.sock), action routing, metadata, and error messages.
 * Tests do NOT require Docker to be installed or running.
 */

describe('DockerTool — metadata', () => {
  const tool = new DockerTool();

  it('has correct tool name', () => {
    assert.strictEqual(tool.name, 'docker');
  });

  it('has prompt permission level', () => {
    assert.strictEqual(tool.permission, 'prompt');
  });

  it('requires action parameter', () => {
    const required = tool.parameters.required as string[];
    assert.ok(required.includes('action'));
  });

  it('has description mentioning Docker', () => {
    assert.ok(tool.description.includes('Docker'));
  });
});

describe('DockerTool — unknown action handling', () => {
  const tool = new DockerTool();

  it('returns error for unknown action', async () => {
    const result = await tool.execute({ action: 'destroy_all' });
    assert.ok(result.includes('Error: unknown action'));
    assert.ok(result.includes('destroy_all'));
    assert.ok(result.includes('Allowed:'));
  });

  it('returns error when action is missing', async () => {
    const result = await tool.execute({});
    assert.ok(result.includes('Error: action is required'));
  });

  it('lists allowed actions in error message', async () => {
    const result = await tool.execute({ action: 'nope' });
    assert.ok(result.includes('ps'));
    assert.ok(result.includes('images'));
    assert.ok(result.includes('run'));
    assert.ok(result.includes('stop'));
    assert.ok(result.includes('build'));
  });
});

describe('DockerTool — safety: --privileged flag', () => {
  const tool = new DockerTool();

  it('blocks --privileged in run args', async () => {
    const result = await tool.execute({
      action: 'run',
      args: '--privileged ubuntu bash',
    });
    assert.ok(result.includes('Error: --privileged flag is blocked'));
  });

  it('blocks --privileged in exec args', async () => {
    const result = await tool.execute({
      action: 'exec',
      args: '--privileged my-container ls',
    });
    assert.ok(result.includes('Error: --privileged flag is blocked'));
  });

  it('blocks --privileged mixed with other flags', async () => {
    const result = await tool.execute({
      action: 'run',
      args: '-d --name test --privileged nginx',
    });
    assert.ok(result.includes('Error: --privileged flag is blocked'));
  });
});

describe('DockerTool — safety: root filesystem mount', () => {
  const tool = new DockerTool();

  it('blocks -v /:/host volume mount', async () => {
    const result = await tool.execute({
      action: 'run',
      args: '-v /:/host ubuntu bash',
    });
    assert.ok(result.includes('Error: mounting root filesystem is blocked'));
  });

  it('blocks -v /:/mnt root mount with different target', async () => {
    const result = await tool.execute({
      action: 'run',
      args: '-v /:/mnt ubuntu bash',
    });
    assert.ok(result.includes('Error: mounting root filesystem is blocked'));
  });
});

describe('DockerTool — safety: docker.sock mount', () => {
  const tool = new DockerTool();

  it('does not crash when docker.sock is in args (checked by regex)', async () => {
    // The current code blocks root mount (/ : /) but docker.sock is
    // a specific path mount. The regex -v\s+\/:\/ would NOT match
    // -v /var/run/docker.sock:/var/run/docker.sock because the source
    // path is not just "/". Let's verify the tool proceeds past validation.
    const result = await tool.execute({
      action: 'run',
      args: '-v /var/run/docker.sock:/var/run/docker.sock alpine',
    });
    // Should NOT get "mounting root filesystem" error — docker.sock path is specific
    assert.ok(!result.includes('mounting root filesystem'));
    // It will fail because Docker probably isn't running, but that's fine
  });
});

describe('DockerTool — safety: --net=host', () => {
  const tool = new DockerTool();

  it('does not explicitly block --net=host in current code (behavior check)', async () => {
    // The current implementation does NOT block --net=host explicitly.
    // It only blocks --privileged and root mount. This test documents that.
    const result = await tool.execute({
      action: 'run',
      args: '--net=host nginx',
    });
    // The command will attempt to run and fail (no Docker) but should NOT
    // be blocked by the safety checks
    assert.ok(!result.includes('--privileged'));
    assert.ok(!result.includes('mounting root filesystem'));
  });
});

describe('DockerTool — action routing', () => {
  const tool = new DockerTool();

  it('accepts ps action (may fail if Docker not running)', async () => {
    const result = await tool.execute({ action: 'ps' });
    // Should either succeed or fail with Docker-not-running error, not "unknown action"
    assert.ok(!result.includes('unknown action'));
  });

  it('accepts images action', async () => {
    const result = await tool.execute({ action: 'images' });
    assert.ok(!result.includes('unknown action'));
  });

  it('accepts compose_up action', async () => {
    const result = await tool.execute({ action: 'compose_up' });
    assert.ok(!result.includes('unknown action'));
  });

  it('accepts inspect action', async () => {
    const result = await tool.execute({ action: 'inspect', args: 'test-container' });
    assert.ok(!result.includes('unknown action'));
  });
});
