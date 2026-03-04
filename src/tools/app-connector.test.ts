import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import { AppConnectorTool } from './app-connector';
import { ConnectorRegistry } from '../connectors/registry';
import { VaultManager } from '../vault';
import { Connector, ConnectorAction } from '../connectors/base';

/** Minimal mock connector */
function mockConnector(name: string, envKey?: string): Connector {
  const actions: ConnectorAction[] = [
    {
      name: 'test_action',
      description: 'A test action',
      parameters: { type: 'object', properties: { msg: { type: 'string' } } },
      execute: async (args) => `Executed ${name}.test_action: ${args.msg || 'ok'}`,
    },
  ];
  return {
    name,
    displayName: name.charAt(0).toUpperCase() + name.slice(1),
    description: `Mock ${name}`,
    authType: 'api_key',
    envKey,
    actions,
    validate: async (cred) => cred === 'valid-token',
  };
}

describe('AppConnectorTool', () => {
  before(() => {
    process.env.CODEBOT_VAULT_KEY = 'test-key-app';
  });

  after(() => {
    delete process.env.CODEBOT_VAULT_KEY;
  });

  it('has correct tool metadata', () => {
    const vault = new VaultManager();
    const registry = new ConnectorRegistry(vault);
    const tool = new AppConnectorTool(vault, registry);
    assert.strictEqual(tool.name, 'app');
    assert.strictEqual(tool.permission, 'prompt');
    assert.ok(tool.description.includes('GitHub'));
  });

  it('list action returns all connectors', async () => {
    const vault = new VaultManager();
    const registry = new ConnectorRegistry(vault);
    registry.register(mockConnector('mock1'));
    registry.register(mockConnector('mock2'));
    const tool = new AppConnectorTool(vault, registry);
    const result = await tool.execute({ action: 'list' });
    assert.ok(result.includes('Mock1'));
    assert.ok(result.includes('Mock2'));
    assert.ok(result.includes('test_action'));
  });

  it('connect saves to vault on valid token', async () => {
    const vault = new VaultManager();
    const registry = new ConnectorRegistry(vault);
    registry.register(mockConnector('testapp'));
    const tool = new AppConnectorTool(vault, registry);
    const result = await tool.execute({ action: 'connect', app: 'testapp', credential: 'valid-token' });
    assert.ok(result.includes('connected successfully'));
    assert.ok(vault.has('testapp'));
  });

  it('connect rejects invalid token', async () => {
    const vault = new VaultManager();
    const registry = new ConnectorRegistry(vault);
    registry.register(mockConnector('badapp'));
    const tool = new AppConnectorTool(vault, registry);
    const result = await tool.execute({ action: 'connect', app: 'badapp', credential: 'bad-token' });
    assert.ok(result.includes('Error:'));
    assert.ok(!vault.has('badapp'));
  });

  it('dispatches connector action via dot notation', async () => {
    const vault = new VaultManager();
    const registry = new ConnectorRegistry(vault);
    process.env.DISPATCH_TOKEN = 'valid-token';
    registry.register(mockConnector('dispatch', 'DISPATCH_TOKEN'));
    const tool = new AppConnectorTool(vault, registry);
    const result = await tool.execute({ action: 'dispatch.test_action', msg: 'hello' });
    assert.ok(result.includes('Executed dispatch.test_action: hello'));
    delete process.env.DISPATCH_TOKEN;
  });

  it('returns error for unknown connector', async () => {
    const vault = new VaultManager();
    const registry = new ConnectorRegistry(vault);
    const tool = new AppConnectorTool(vault, registry);
    const result = await tool.execute({ action: 'nonexistent.action' });
    assert.ok(result.includes('Error:'));
    assert.ok(result.includes('unknown app'));
  });
});
