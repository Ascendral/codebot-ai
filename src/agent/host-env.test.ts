import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as os from 'os';
import { detectHostEnv, buildHostEnvBlock } from './host-env';

/**
 * Guardrails for the host-env grounding block. These tests exist because
 * the block's whole purpose is to kill Sonnet's "I'm in a Linux sandbox"
 * hallucination — so if the block ever stops carrying concrete facts,
 * the hallucination comes back and users see "python3 doesn't exist".
 */

describe('detectHostEnv', () => {
  it('returns real platform data from node os module (not a stubbed blank)', () => {
    const env = detectHostEnv();
    assert.strictEqual(env.platform, os.platform());
    assert.strictEqual(env.arch, os.arch());
    assert.strictEqual(env.homedir, os.homedir());
    assert.ok(env.cwd.length > 0, 'cwd must be non-empty');
    assert.ok(env.user.length > 0, 'user must be non-empty');
  });

  it('probes a standard set of dev tools', () => {
    const env = detectHostEnv();
    for (const name of ['python3', 'node', 'npm', 'git', 'bash']) {
      assert.ok(name in env.tools, `tools map must include ${name}`);
    }
  });

  it('finds node itself (the test runner proves it exists)', () => {
    const env = detectHostEnv();
    // If node can run this test, `which node` must succeed on PATH.
    assert.ok(
      env.tools.node && env.tools.node.length > 0,
      `expected node on PATH, got ${env.tools.node}`,
    );
  });
});

describe('buildHostEnvBlock', () => {
  it('includes the exact anti-sandbox sentence the model needs to see', () => {
    const block = buildHostEnvBlock();
    assert.match(
      block,
      /running on the user's real computer via a native shell-exec tool, NOT in a sandboxed code-execution container/,
    );
  });

  it('renders detected OS name (macOS/Linux/Windows) not the raw platform code', () => {
    const block = buildHostEnvBlock({
      platform: 'darwin',
      release: '24.0.0',
      arch: 'arm64',
      homedir: '/Users/test',
      cwd: '/tmp',
      shell: '/bin/zsh',
      user: 'test',
      tools: { python3: '/opt/homebrew/bin/python3' },
    });
    assert.match(block, /OS:\s+macOS/);
    assert.doesNotMatch(block, /OS:\s+darwin /); // the friendly name wins the label
  });

  it('lists tool paths verbatim so the model cannot claim they are missing', () => {
    const block = buildHostEnvBlock({
      platform: 'darwin', release: '24.0.0', arch: 'arm64',
      homedir: '/Users/test', cwd: '/tmp', shell: '/bin/zsh', user: 'test',
      tools: {
        python3: '/opt/homebrew/bin/python3',
        brew: null,
      },
    });
    assert.match(block, /python3:\s+\/opt\/homebrew\/bin\/python3/);
    assert.match(block, /brew:\s+not found/);
  });
});
