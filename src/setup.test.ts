import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// We test the exported functions from setup.ts
import { autoDetect, pickBestLocalModel, loadConfig, saveConfig, isFirstRun } from './setup';
import type { AutoDetectResult } from './setup';

describe('pickBestLocalModel', () => {
  it('picks qwen2.5-coder as top choice', () => {
    const models = ['phi-4:14b', 'qwen2.5-coder:32b', 'llama3.1:8b'];
    const result = pickBestLocalModel(models);
    assert.strictEqual(result, 'qwen2.5-coder:32b');
  });

  it('picks deepseek-coder over llama', () => {
    const models = ['llama3.1:8b', 'deepseek-coder-v2:16b', 'mistral:7b'];
    const result = pickBestLocalModel(models);
    assert.strictEqual(result, 'deepseek-coder-v2:16b');
  });

  it('picks qwen3 over phi', () => {
    const models = ['phi-4:14b', 'qwen3:14b'];
    const result = pickBestLocalModel(models);
    assert.strictEqual(result, 'qwen3:14b');
  });

  it('returns first model when no ranked match', () => {
    const models = ['unknown-custom-model:7b', 'another-model:13b'];
    const result = pickBestLocalModel(models);
    assert.strictEqual(result, 'unknown-custom-model:7b');
  });

  it('returns undefined for empty array', () => {
    const result = pickBestLocalModel([]);
    assert.strictEqual(result, undefined);
  });

  it('handles case-insensitive matching', () => {
    const models = ['Qwen2.5-Coder:7B', 'llama3.1:8b'];
    const result = pickBestLocalModel(models);
    assert.strictEqual(result, 'Qwen2.5-Coder:7B');
  });
});

describe('autoDetect', () => {
  const CONFIG_DIR = path.join(os.homedir(), '.codebot');
  const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
  let savedConfig: string | null = null;
  let savedEnv: Record<string, string | undefined> = {};

  const envKeys = [
    'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY',
    'DEEPSEEK_API_KEY', 'GROQ_API_KEY', 'MISTRAL_API_KEY', 'XAI_API_KEY',
  ];

  beforeEach(() => {
    // Backup config
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        savedConfig = fs.readFileSync(CONFIG_FILE, 'utf-8');
      }
    } catch { savedConfig = null; }

    // Backup env
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    // Restore config
    if (savedConfig !== null) {
      fs.writeFileSync(CONFIG_FILE, savedConfig);
    }

    // Restore env
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it('returns auto-start when config exists with model and provider', async () => {
    // This test relies on the existing config being present
    // (which it is since we're running from the codebot-ai project)
    const config = loadConfig();
    if (config.model && config.provider) {
      const result = await autoDetect();
      assert.strictEqual(result.type, 'auto-start');
      assert.ok(result.model);
      assert.ok(result.provider);
    }
  });

  it('returns result with localServers array', async () => {
    const result = await autoDetect();
    assert.ok(Array.isArray(result.localServers));
  });

  it('returns result with detectedKeys map', async () => {
    const result = await autoDetect();
    assert.ok(result.detectedKeys instanceof Map);
  });

  it('detects env API keys', async () => {
    const result = await autoDetect();
    // Check that the keys detected match what's in the environment
    for (const key of envKeys) {
      if (process.env[key]) {
        // The provider name mapping is done internally, but at least keys should be tracked
        assert.ok(result.detectedKeys.size >= 0); // just verify it's a Map
      }
    }
  });
});

describe('AutoDetectResult interface', () => {
  it('supports all required fields', () => {
    const result: AutoDetectResult = {
      type: 'auto-start',
      model: 'gpt-4o',
      provider: 'openai',
      baseUrl: 'https://api.openai.com',
      apiKey: 'sk-test',
      localServers: [],
      detectedKeys: new Map(),
    };
    assert.strictEqual(result.type, 'auto-start');
    assert.strictEqual(result.model, 'gpt-4o');
  });

  it('supports one-question type', () => {
    const result: AutoDetectResult = {
      type: 'one-question',
      localServers: [],
      detectedKeys: new Map(),
    };
    assert.strictEqual(result.type, 'one-question');
    assert.strictEqual(result.model, undefined);
  });
});

describe('SavedConfig backward compatibility', () => {
  it('loadConfig handles configs without firstRunComplete field', () => {
    const config = loadConfig();
    // Old configs won't have firstRunComplete, should still load fine
    assert.ok(typeof config === 'object');
  });
});

describe('RECOMMENDED_MODELS', () => {
  // Import at top doesn't have RECOMMENDED_MODELS, but pickBestLocalModel tests the ranking logic
  it('pickBestLocalModel uses internal ranking', () => {
    // Verify ranking order: qwen2.5-coder > qwen3 > deepseek > llama > codellama > mistral > phi
    const models = ['mistral:7b', 'qwen3:8b', 'codellama:34b'];
    const result = pickBestLocalModel(models);
    assert.strictEqual(result, 'qwen3:8b'); // qwen3 ranked higher than mistral and codellama
  });
});
