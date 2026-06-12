/**
 * Provider-aware API key resolution for the Electron main process.
 *
 * Background — the bug PR 28.5 fixes:
 *   The previous resolver did `if (config.apiKey) apiKey = config.apiKey`
 *   FIRST, treating the legacy `apiKey` slot as the canonical Anthropic
 *   key. But `config.apiKey` is provider-agnostic — `setup.ts` will
 *   sometimes write an OpenAI key (sk-proj-...) into it. When that
 *   happened with `config.provider = 'anthropic'`, the dashboard
 *   subprocess received the OpenAI key as `ANTHROPIC_API_KEY`, the
 *   Anthropic API returned 401, and the dashboard banner read
 *   "API key is invalid or expired."
 *
 * Resolution order per provider (highest priority first):
 *   1. provider-specific env var      (e.g. process.env.ANTHROPIC_API_KEY)
 *   2. provider-specific config field (e.g. config.anthropicApiKey)
 *   3. .env files (already-parsed key/value map handed in)
 *   4. legacy config.apiKey — ONLY when:
 *        a) config.provider matches the requested provider, AND
 *        b) the key's shape matches that provider (cheap guard against
 *           the exact bug above)
 *
 * Pure function, no fs / no env reads. The caller assembles `inputs` and
 * the resolver makes deterministic decisions on it. This lets us unit-test
 * the resolution logic without spinning Electron.
 */

'use strict';

/**
 * Cheap shape check — does the key look like one of the provider's keys?
 * False negatives are tolerable (we just won't accept the legacy slot for
 * that provider); false positives risk re-introducing the bug.
 */
function looksLike(provider, key) {
  if (!key || typeof key !== 'string') return false;
  switch (provider) {
    case 'anthropic':
      return key.startsWith('sk-ant-');
    case 'openai':
      // sk-proj-... and bare sk-... but explicitly NOT sk-ant-...
      return (key.startsWith('sk-proj-') || key.startsWith('sk-')) && !key.startsWith('sk-ant-');
    case 'gemini':
      return key.startsWith('AIza');
    default:
      return false;
  }
}

const PROVIDER_META = {
  anthropic: { envName: 'ANTHROPIC_API_KEY', configField: 'anthropicApiKey' },
  openai: { envName: 'OPENAI_API_KEY', configField: 'openaiApiKey' },
  gemini: { envName: 'GEMINI_API_KEY', configField: 'geminiApiKey' },
};

/**
 * @param {string} provider — 'anthropic' | 'openai' | 'gemini'
 * @param {object} inputs
 * @param {object} inputs.env       — process.env-shaped object
 * @param {object} inputs.config    — parsed ~/.codebot/config.json (may be {})
 * @param {object} inputs.envFiles  — merged key/value map parsed from .env files
 * @returns {{ key: string|null, source: string|null }}
 */
function resolveKey(provider, inputs) {
  const meta = PROVIDER_META[provider];
  if (!meta) return { key: null, source: null };

  const env = inputs.env || {};
  const config = inputs.config || {};
  const envFiles = inputs.envFiles || {};

  // 1. Provider-specific env var.
  const fromEnv = env[meta.envName];
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    return { key: fromEnv, source: `env:${meta.envName}` };
  }

  // 2. Provider-specific config field.
  const fromConfig = config[meta.configField];
  if (typeof fromConfig === 'string' && fromConfig.length > 0) {
    return { key: fromConfig, source: `config:${meta.configField}` };
  }

  // 3. .env files (provider-specific name).
  const fromEnvFile = envFiles[meta.envName];
  if (typeof fromEnvFile === 'string' && fromEnvFile.length > 0) {
    return { key: fromEnvFile, source: `envfile:${meta.envName}` };
  }

  // 4. Legacy config.apiKey — guarded.
  if (
    typeof config.apiKey === 'string' &&
    config.apiKey.length > 0 &&
    config.provider === provider &&
    looksLike(provider, config.apiKey)
  ) {
    return { key: config.apiKey, source: 'config:apiKey(legacy)' };
  }

  return { key: null, source: null };
}

/** Convenience: resolve all three at once. */
function resolveAll(inputs) {
  return {
    anthropic: resolveKey('anthropic', inputs),
    openai: resolveKey('openai', inputs),
    gemini: resolveKey('gemini', inputs),
  };
}

module.exports = { resolveKey, resolveAll, looksLike };
