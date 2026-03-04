import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { OpenAIImagesConnector } from './openai-images';

describe('OpenAIImagesConnector', () => {
  it('has correct metadata', () => {
    const c = new OpenAIImagesConnector();
    assert.strictEqual(c.name, 'openai_images');
    assert.strictEqual(c.displayName, 'OpenAI Images');
    assert.strictEqual(c.envKey, 'OPENAI_API_KEY');
    assert.strictEqual(c.authType, 'api_key');
  });

  it('has all expected actions', () => {
    const c = new OpenAIImagesConnector();
    const names = c.actions.map(a => a.name);
    assert.ok(names.includes('generate'));
    assert.ok(names.includes('edit'));
    assert.ok(names.includes('variation'));
    assert.strictEqual(c.actions.length, 3);
  });

  it('generate requires prompt', async () => {
    const c = new OpenAIImagesConnector();
    const action = c.actions.find(a => a.name === 'generate')!;
    const result = await action.execute({ prompt: '' }, 'fake-key');
    assert.ok(result.includes('Error:'));
  });

  it('edit requires image and prompt', async () => {
    const c = new OpenAIImagesConnector();
    const action = c.actions.find(a => a.name === 'edit')!;
    const result = await action.execute({ image: '', prompt: '' }, 'fake-key');
    assert.ok(result.includes('Error:'));
  });
});
