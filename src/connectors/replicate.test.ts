import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { ReplicateConnector } from './replicate';

describe('ReplicateConnector', () => {
  it('has correct metadata', () => {
    const c = new ReplicateConnector();
    assert.strictEqual(c.name, 'replicate');
    assert.strictEqual(c.displayName, 'Replicate');
    assert.strictEqual(c.envKey, 'REPLICATE_API_TOKEN');
    assert.strictEqual(c.authType, 'api_key');
  });

  it('has all expected actions', () => {
    const c = new ReplicateConnector();
    const names = c.actions.map(a => a.name);
    assert.ok(names.includes('generate'));
    assert.ok(names.includes('list_models'));
    assert.ok(names.includes('upscale'));
    assert.ok(names.includes('remove_background'));
    assert.strictEqual(c.actions.length, 4);
  });

  it('generate requires prompt', async () => {
    const c = new ReplicateConnector();
    const action = c.actions.find(a => a.name === 'generate')!;
    const result = await action.execute({ prompt: '' }, 'fake-token');
    assert.ok(result.includes('Error:'));
  });

  it('upscale requires image path', async () => {
    const c = new ReplicateConnector();
    const action = c.actions.find(a => a.name === 'upscale')!;
    const result = await action.execute({}, 'fake-token');
    assert.ok(result.includes('Error:'));
  });

  it('remove_background requires image path', async () => {
    const c = new ReplicateConnector();
    const action = c.actions.find(a => a.name === 'remove_background')!;
    const result = await action.execute({}, 'fake-token');
    assert.ok(result.includes('Error:'));
  });
});
