import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { DEFAULT_DASHBOARD_PORT, resolveDashboardPort } from './dashboard-config';

describe('resolveDashboardPort', () => {
  it('returns the default port when no override is set', () => {
    assert.strictEqual(resolveDashboardPort({}), DEFAULT_DASHBOARD_PORT);
  });

  it('accepts a valid CODEBOT_DASHBOARD_PORT override', () => {
    assert.strictEqual(resolveDashboardPort({ CODEBOT_DASHBOARD_PORT: '3137' }), 3137);
  });

  it('falls back to the default port for invalid values', () => {
    assert.strictEqual(resolveDashboardPort({ CODEBOT_DASHBOARD_PORT: 'abc' }), DEFAULT_DASHBOARD_PORT);
    assert.strictEqual(resolveDashboardPort({ CODEBOT_DASHBOARD_PORT: '0' }), DEFAULT_DASHBOARD_PORT);
    assert.strictEqual(resolveDashboardPort({ CODEBOT_DASHBOARD_PORT: '70000' }), DEFAULT_DASHBOARD_PORT);
  });
});
