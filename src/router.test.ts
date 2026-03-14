import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { classifyComplexity, selectModel, ModelTier, RouterConfig } from './router';

describe('classifyComplexity', () => {
  it('classifies simple read operations as fast', () => {
    assert.strictEqual(classifyComplexity('read file.ts'), 'fast');
  });

  it('classifies short questions as fast', () => {
    assert.strictEqual(classifyComplexity('what is this?'), 'fast');
  });

  it('classifies edit operations as standard', () => {
    assert.strictEqual(classifyComplexity('edit the function to handle null'), 'standard');
  });

  it('classifies refactor requests as powerful', () => {
    assert.strictEqual(classifyComplexity('refactor the entire authentication module'), 'powerful');
  });

  it('classifies architecture requests as powerful', () => {
    assert.strictEqual(classifyComplexity('architect a new microservice design'), 'powerful');
  });

  it('classifies long messages as powerful', () => {
    const longMsg = Array(100).fill('word').join(' ');
    assert.strictEqual(classifyComplexity(longMsg), 'powerful');
  });

  it('uses last tool calls for context', () => {
    assert.strictEqual(classifyComplexity('continue', ['browser']), 'powerful');
    assert.strictEqual(classifyComplexity('keep going', ['read_file']), 'fast');
  });

  it('classifies security scan as powerful', () => {
    assert.strictEqual(classifyComplexity('run a security audit on the codebase'), 'powerful');
  });

  it('classifies test/build as standard', () => {
    assert.strictEqual(classifyComplexity('run the tests'), 'standard');
  });

  it('classifies fix operations as standard', () => {
    assert.strictEqual(classifyComplexity('fix the bug in login'), 'standard');
  });
});

describe('selectModel', () => {
  const config: RouterConfig = {
    enabled: true,
    fastModel: 'haiku',
    standardModel: 'sonnet',
    powerfulModel: 'opus',
  };

  it('selects fast model for fast tier', () => {
    const result = selectModel('fast', config, 'default-model');
    assert.strictEqual(result, 'haiku');
  });

  it('selects standard model for standard tier', () => {
    const result = selectModel('standard', config, 'default-model');
    assert.strictEqual(result, 'sonnet');
  });

  it('selects powerful model for powerful tier', () => {
    const result = selectModel('powerful', config, 'default-model');
    assert.strictEqual(result, 'opus');
  });

  it('falls back to default when disabled', () => {
    const disabled: RouterConfig = { enabled: false };
    const result = selectModel('powerful', disabled, 'default-model');
    assert.strictEqual(result, 'default-model');
  });

  it('falls back to default when tier model is missing', () => {
    const partial: RouterConfig = { enabled: true, fastModel: 'haiku' };
    const result = selectModel('powerful', partial, 'default-model');
    assert.strictEqual(result, 'default-model');
  });
});
