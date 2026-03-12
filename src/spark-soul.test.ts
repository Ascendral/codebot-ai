import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  scoreToDecision,
  classifyFailure,
  failureToOutcome,
  resolveToolCategory,
  resolveToolOperation,
  SparkSoul,
} from './spark-soul';

// ── Group 1: scoreToDecision ─────────────────────────────────────

describe('SparkSoul: scoreToDecision', () => {
  it('returns ALLOW for scores below 20', () => {
    assert.strictEqual(scoreToDecision(0), 'ALLOW');
    assert.strictEqual(scoreToDecision(10), 'ALLOW');
    assert.strictEqual(scoreToDecision(19), 'ALLOW');
  });

  it('returns CHALLENGE for scores 20-74', () => {
    assert.strictEqual(scoreToDecision(20), 'CHALLENGE');
    assert.strictEqual(scoreToDecision(50), 'CHALLENGE');
    assert.strictEqual(scoreToDecision(74), 'CHALLENGE');
  });

  it('returns BLOCK for scores 75+', () => {
    assert.strictEqual(scoreToDecision(75), 'BLOCK');
    assert.strictEqual(scoreToDecision(99), 'BLOCK');
    assert.strictEqual(scoreToDecision(100), 'BLOCK');
  });
});

// ── Group 2: classifyFailure ─────────────────────────────────────

describe('SparkSoul: classifyFailure', () => {
  it('classifies security keywords as security_block', () => {
    assert.strictEqual(classifyFailure('Request blocked by policy'), 'security_block');
    assert.strictEqual(classifyFailure('Permission denied'), 'security_block');
    assert.strictEqual(classifyFailure('403 Forbidden'), 'security_block');
    assert.strictEqual(classifyFailure('Unauthorized access'), 'security_block');
    assert.strictEqual(classifyFailure('denied by constitutional'), 'security_block');
    assert.strictEqual(classifyFailure('Security violation detected'), 'security_block');
  });

  it('classifies input errors as input_error', () => {
    assert.strictEqual(classifyFailure('File not found'), 'input_error');
    assert.strictEqual(classifyFailure('ENOENT: no such file or directory'), 'input_error');
    assert.strictEqual(classifyFailure('Invalid JSON provided'), 'input_error');
    assert.strictEqual(classifyFailure('Missing required field: path'), 'input_error');
    assert.strictEqual(classifyFailure('Path does not exist'), 'input_error');
    assert.strictEqual(classifyFailure('No such file: test.txt'), 'input_error');
    assert.strictEqual(classifyFailure('Bad request: malformed input'), 'input_error');
  });

  it('classifies unknown errors as runtime_error', () => {
    assert.strictEqual(classifyFailure('Something went wrong'), 'runtime_error');
    assert.strictEqual(classifyFailure('Connection timeout'), 'runtime_error');
    assert.strictEqual(classifyFailure('Out of memory'), 'runtime_error');
    assert.strictEqual(classifyFailure(''), 'runtime_error');
  });
});

// ── Group 3: failureToOutcome ────────────────────────────────────

describe('SparkSoul: failureToOutcome', () => {
  it('maps security_block to blocked with high intensity', () => {
    const r = failureToOutcome('security_block');
    assert.strictEqual(r.outcome, 'blocked');
    assert.strictEqual(r.intensity, 0.8);
  });

  it('maps input_error to partial with low intensity', () => {
    const r = failureToOutcome('input_error');
    assert.strictEqual(r.outcome, 'partial');
    assert.strictEqual(r.intensity, 0.2);
  });

  it('maps runtime_error to failure with medium intensity', () => {
    const r = failureToOutcome('runtime_error');
    assert.strictEqual(r.outcome, 'failure');
    assert.strictEqual(r.intensity, 0.6);
  });
});

// ── Group 4: resolveToolCategory ─────────────────────────────────

describe('SparkSoul: resolveToolCategory', () => {
  it('resolves execute + rm as destructive', () => {
    assert.strictEqual(resolveToolCategory('execute', { command: 'rm -rf /tmp/test' }), 'destructive');
  });

  it('resolves execute + kill as destructive', () => {
    assert.strictEqual(resolveToolCategory('execute', { command: 'kill 12345' }), 'destructive');
  });

  it('resolves execute + curl as communication', () => {
    assert.strictEqual(resolveToolCategory('execute', { command: 'curl https://api.example.com' }), 'communication');
  });

  it('resolves execute + ls as readonly', () => {
    assert.strictEqual(resolveToolCategory('execute', { command: 'ls -la' }), 'readonly');
  });

  it('resolves execute with unknown command as general', () => {
    assert.strictEqual(resolveToolCategory('execute', { command: 'npm install' }), 'general');
  });

  it('resolves git + push as publication', () => {
    assert.strictEqual(resolveToolCategory('git', { subcommand: 'push' }), 'publication');
  });

  it('resolves git + reset --hard as destructive', () => {
    assert.strictEqual(resolveToolCategory('git', { subcommand: 'reset --hard HEAD~1' }), 'destructive');
  });

  it('resolves git + status as readonly', () => {
    assert.strictEqual(resolveToolCategory('git', { subcommand: 'status' }), 'readonly');
  });

  it('resolves git + diff as readonly', () => {
    assert.strictEqual(resolveToolCategory('git', { subcommand: 'diff' }), 'readonly');
  });

  it('falls back to static TOOL_CATEGORY for known tools', () => {
    assert.strictEqual(resolveToolCategory('read_file', {}), 'readonly');
    assert.strictEqual(resolveToolCategory('delete_file', {}), 'destructive');
    assert.strictEqual(resolveToolCategory('browser', {}), 'communication');
    assert.strictEqual(resolveToolCategory('write_file', {}), 'general');
    assert.strictEqual(resolveToolCategory('routine', {}), 'scheduling');
  });

  it('returns general for unknown tools', () => {
    assert.strictEqual(resolveToolCategory('unknown_tool', {}), 'general');
    assert.strictEqual(resolveToolCategory('my_custom_tool', {}), 'general');
  });
});

// ── Group 5: resolveToolOperation ────────────────────────────────

describe('SparkSoul: resolveToolOperation', () => {
  it('resolves execute + rm as delete', () => {
    assert.strictEqual(resolveToolOperation('execute', { command: 'rm file.txt' }), 'delete');
  });

  it('resolves execute + curl as send', () => {
    assert.strictEqual(resolveToolOperation('execute', { command: 'curl http://example.com' }), 'send');
  });

  it('resolves execute + ls as read', () => {
    assert.strictEqual(resolveToolOperation('execute', { command: 'ls -la' }), 'read');
  });

  it('resolves execute with default operation', () => {
    assert.strictEqual(resolveToolOperation('execute', { command: 'npm test' }), 'execute');
  });

  it('resolves git + push as publish', () => {
    assert.strictEqual(resolveToolOperation('git', { subcommand: 'push' }), 'publish');
  });

  it('resolves git + status as read', () => {
    assert.strictEqual(resolveToolOperation('git', { subcommand: 'status' }), 'read');
  });

  it('resolves git + commit as write', () => {
    assert.strictEqual(resolveToolOperation('git', { subcommand: 'commit' }), 'write');
  });

  it('resolves git + reset as delete', () => {
    assert.strictEqual(resolveToolOperation('git', { subcommand: 'reset --hard' }), 'delete');
  });

  it('falls back to TOOL_OPERATION for known tools', () => {
    assert.strictEqual(resolveToolOperation('read_file', {}), 'read');
    assert.strictEqual(resolveToolOperation('delete_file', {}), 'delete');
    assert.strictEqual(resolveToolOperation('web_search', {}), 'search');
    assert.strictEqual(resolveToolOperation('write_file', {}), 'write');
  });

  it('returns tool name for unknown tools', () => {
    assert.strictEqual(resolveToolOperation('mystery_tool', {}), 'mystery_tool');
  });
});

// ── Group 6: SparkSoul class — graceful degradation ──────────────

describe('SparkSoul: class integration (graceful degradation)', () => {
  // These tests verify SparkSoul is a safe no-op when spark-engine is unavailable.
  // The constructor uses dynamic require() which will fail in test env without spark-engine.

  it('isActive returns a boolean', () => {
    const soul = new SparkSoul('/tmp/spark-test-' + Date.now());
    assert.ok(typeof soul.isActive === 'boolean');
  });

  it('getPromptBlock returns empty string when not initialized', () => {
    const soul = new SparkSoul('/tmp/spark-test-' + Date.now());
    if (!soul.isActive) {
      assert.strictEqual(soul.getPromptBlock('test'), '');
    }
  });

  it('evaluateTool returns ALLOW when not initialized', () => {
    const soul = new SparkSoul('/tmp/spark-test-' + Date.now());
    if (!soul.isActive) {
      const result = soul.evaluateTool('read_file', { path: '/test' });
      assert.strictEqual(result.decision, 'ALLOW');
    }
  });

  it('recordOutcome does not throw when not initialized', () => {
    const soul = new SparkSoul('/tmp/spark-test-' + Date.now());
    assert.doesNotThrow(() => {
      soul.recordOutcome('read_file', {}, true, 'ok', 100);
    });
  });

  it('recordOutcome does not throw on failure path', () => {
    const soul = new SparkSoul('/tmp/spark-test-' + Date.now());
    assert.doesNotThrow(() => {
      soul.recordOutcome('read_file', {}, false, 'File not found', 50);
    });
  });

  it('finalizeSession returns empty object when not initialized', () => {
    const soul = new SparkSoul('/tmp/spark-test-' + Date.now());
    if (!soul.isActive) {
      const result = soul.finalizeSession();
      assert.deepStrictEqual(result, {});
    }
  });

  it('getEmotionalState returns null when not initialized', () => {
    const soul = new SparkSoul('/tmp/spark-test-' + Date.now());
    if (!soul.isActive) {
      assert.strictEqual(soul.getEmotionalState(), null);
    }
  });

  it('getPersonality returns null when not initialized', () => {
    const soul = new SparkSoul('/tmp/spark-test-' + Date.now());
    if (!soul.isActive) {
      assert.strictEqual(soul.getPersonality(), null);
    }
  });

  it('getWeights returns null when not initialized', () => {
    const soul = new SparkSoul('/tmp/spark-test-' + Date.now());
    if (!soul.isActive) {
      assert.strictEqual(soul.getWeights(), null);
    }
  });

  it('getLearningStats returns zero counts', () => {
    const soul = new SparkSoul('/tmp/spark-test-' + Date.now());
    const stats = soul.getLearningStats();
    assert.strictEqual(stats.totalEpisodes, 0);
    assert.strictEqual(stats.successCount, 0);
    assert.strictEqual(stats.failureCount, 0);
    assert.strictEqual(stats.successRate, 0);
    assert.strictEqual(stats.predictions, 0);
  });

  it('getAwarenessReport returns null when not initialized', () => {
    const soul = new SparkSoul('/tmp/spark-test-' + Date.now());
    if (!soul.isActive) {
      assert.strictEqual(soul.getAwarenessReport(), null);
    }
  });
});
