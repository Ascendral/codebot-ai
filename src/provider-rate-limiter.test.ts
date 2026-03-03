import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { ProviderRateLimiter, PROVIDER_RATE_DEFAULTS } from './provider-rate-limiter';

describe('ProviderRateLimiter', () => {
  it('acquire allows requests under RPM limit', async () => {
    const limiter = new ProviderRateLimiter('anthropic');
    const waitMs = await limiter.acquire();
    assert.strictEqual(waitMs, 0, 'First request should not wait');
    limiter.release();
  });

  it('release decrements active request count', async () => {
    const limiter = new ProviderRateLimiter('local', { concurrentRequests: 2 });
    await limiter.acquire();
    await limiter.acquire();
    const util1 = limiter.getUtilization();
    assert.strictEqual(util1.concurrentPercent, 100);
    limiter.release();
    const util2 = limiter.getUtilization();
    assert.strictEqual(util2.concurrentPercent, 50);
    limiter.release();
  });

  it('recordTokens tracks TPM', () => {
    const limiter = new ProviderRateLimiter('openai');
    limiter.recordTokens(5000);
    limiter.recordTokens(3000);
    const util = limiter.getUtilization();
    assert.ok(util.tpmPercent > 0, `TPM should be tracked: ${util.tpmPercent}%`);
  });

  it('getUtilization returns valid percentages', async () => {
    const limiter = new ProviderRateLimiter('anthropic');
    await limiter.acquire();
    limiter.recordTokens(10000);
    const util = limiter.getUtilization();
    assert.strictEqual(typeof util.rpmPercent, 'number');
    assert.strictEqual(typeof util.tpmPercent, 'number');
    assert.strictEqual(typeof util.concurrentPercent, 'number');
    assert.ok(util.rpmPercent >= 0 && util.rpmPercent <= 100);
    limiter.release();
  });

  it('backoff reduces RPM by 50%', () => {
    const limiter = new ProviderRateLimiter('anthropic');
    const before = limiter.getConfig().requestsPerMinute;
    limiter.backoff();
    const after = limiter.getConfig().requestsPerMinute;
    assert.strictEqual(after, Math.floor(before / 2));
  });

  it('recover restores original limits', () => {
    const limiter = new ProviderRateLimiter('openai');
    const original = limiter.getConfig().requestsPerMinute;
    limiter.backoff();
    assert.notStrictEqual(limiter.getConfig().requestsPerMinute, original);
    limiter.recover();
    assert.strictEqual(limiter.getConfig().requestsPerMinute, original);
  });

  it('defaults exist for all major providers', () => {
    const providers = ['anthropic', 'openai', 'gemini', 'deepseek', 'groq', 'mistral', 'xai', 'local'];
    for (const p of providers) {
      assert.ok(PROVIDER_RATE_DEFAULTS[p], `Missing defaults for ${p}`);
      assert.ok(PROVIDER_RATE_DEFAULTS[p].requestsPerMinute > 0);
      assert.ok(PROVIDER_RATE_DEFAULTS[p].tokensPerMinute > 0);
      assert.ok(PROVIDER_RATE_DEFAULTS[p].concurrentRequests > 0);
    }
  });

  it('constructor accepts overrides', () => {
    const limiter = new ProviderRateLimiter('anthropic', { requestsPerMinute: 10 });
    const config = limiter.getConfig();
    assert.strictEqual(config.requestsPerMinute, 10);
    assert.strictEqual(config.tokensPerMinute, 100_000); // default preserved
  });

  it('updateLimits changes config at runtime', () => {
    const limiter = new ProviderRateLimiter('openai');
    limiter.updateLimits({ tokensPerMinute: 200_000 });
    assert.strictEqual(limiter.getConfig().tokensPerMinute, 200_000);
  });

  it('unknown provider falls back to local defaults', () => {
    const limiter = new ProviderRateLimiter('unknown-provider');
    const config = limiter.getConfig();
    assert.strictEqual(config.requestsPerMinute, 999);
  });
});
