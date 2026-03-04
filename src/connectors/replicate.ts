/**
 * Replicate Connector — Access to Flux, Stable Diffusion, and hundreds of models
 *
 * Auth: REPLICATE_API_TOKEN
 * Actions: generate (run a model), list_models, get_prediction
 *
 * Popular image models:
 *   black-forest-labs/flux-1.1-pro     — Flux Pro (best quality)
 *   black-forest-labs/flux-schnell     — Flux Schnell (fast)
 *   stability-ai/sdxl                  — Stable Diffusion XL
 *   bytedance/sdxl-lightning-4step     — SDXL Lightning (very fast)
 */

import * as fs from 'fs';
import * as path from 'path';
import { Connector, ConnectorAction } from './base';

const BASE_URL = 'https://api.replicate.com/v1';
const TIMEOUT = 120_000; // Image generation can take a while
const POLL_INTERVAL = 2_000;
const MAX_POLL_TIME = 300_000; // 5 minute max

async function apiRequest(
  method: string,
  endpoint: string,
  credential: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; data: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const opts: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${credential}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait',
      },
      signal: controller.signal,
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${BASE_URL}${endpoint}`, opts);
    clearTimeout(timer);
    const data = await res.json();
    return { status: res.status, data };
  } catch (err: unknown) {
    clearTimeout(timer);
    throw err;
  }
}

/** Poll a prediction until it completes or fails */
async function pollPrediction(
  id: string,
  credential: string,
): Promise<{ id: string; status: string; output: unknown; error?: string }> {
  const start = Date.now();
  while (Date.now() - start < MAX_POLL_TIME) {
    const { data } = await apiRequest('GET', `/predictions/${id}`, credential);
    const pred = data as { id: string; status: string; output: unknown; error?: string };
    if (pred.status === 'succeeded' || pred.status === 'failed' || pred.status === 'canceled') {
      return pred;
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
  }
  return { id, status: 'timeout', output: null, error: 'Prediction timed out' };
}

/** Download an image URL to a local file */
async function downloadImage(url: string, outputDir: string, prefix: string): Promise<string> {
  fs.mkdirSync(outputDir, { recursive: true });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    // Detect extension from URL or content type
    const ext = url.match(/\.(png|jpg|jpeg|webp|gif)/i)?.[1] || 'png';
    const filename = `${prefix}-${Date.now()}.${ext}`;
    const filePath = path.join(outputDir, filename);
    fs.writeFileSync(filePath, buffer);
    return filePath;
  } catch (err: unknown) {
    clearTimeout(timer);
    throw err;
  }
}

/** Default model shortcuts */
const MODEL_SHORTCUTS: Record<string, string> = {
  'flux-pro': 'black-forest-labs/flux-1.1-pro',
  'flux-schnell': 'black-forest-labs/flux-schnell',
  'flux': 'black-forest-labs/flux-1.1-pro',
  'sdxl': 'stability-ai/sdxl:7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc',
  'sdxl-lightning': 'bytedance/sdxl-lightning-4step:5f24084160c9089501c1b3545d9be3c27883ae2239b6f412990e82d4a6210f8f',
  'sd3': 'stability-ai/stable-diffusion-3',
};

export class ReplicateConnector implements Connector {
  name = 'replicate';
  displayName = 'Replicate';
  description = 'Generate images with Flux, Stable Diffusion, and hundreds of other AI models via Replicate.';
  authType: Connector['authType'] = 'api_key';
  envKey = 'REPLICATE_API_TOKEN';

  actions: ConnectorAction[] = [
    {
      name: 'generate',
      description: 'Generate an image using a Replicate model (Flux, SDXL, etc.)',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Text description of the image to generate' },
          model: { type: 'string', description: 'Model: flux-pro, flux-schnell, sdxl, sdxl-lightning, sd3, or full model ID (default: flux-schnell)' },
          negative_prompt: { type: 'string', description: 'What to avoid in the image' },
          width: { type: 'number', description: 'Image width (default: 1024)' },
          height: { type: 'number', description: 'Image height (default: 1024)' },
          num_outputs: { type: 'number', description: 'Number of images to generate (default: 1)' },
          guidance_scale: { type: 'number', description: 'How closely to follow the prompt (default varies by model)' },
          num_inference_steps: { type: 'number', description: 'Number of denoising steps (more = better quality, slower)' },
          seed: { type: 'number', description: 'Random seed for reproducibility' },
          output_dir: { type: 'string', description: 'Directory to save images (default: current directory)' },
        },
        required: ['prompt'],
      },
      execute: async (args, cred) => {
        const prompt = args.prompt as string;
        if (!prompt) return 'Error: prompt is required';

        const modelKey = (args.model as string) || 'flux-schnell';
        const modelId = MODEL_SHORTCUTS[modelKey] || modelKey;
        const outputDir = (args.output_dir as string) || process.cwd();

        // Build input based on what the model expects
        const input: Record<string, unknown> = { prompt };
        if (args.negative_prompt) input.negative_prompt = args.negative_prompt;
        if (args.width) input.width = args.width;
        if (args.height) input.height = args.height;
        if (args.num_outputs) input.num_outputs = args.num_outputs;
        if (args.guidance_scale) input.guidance_scale = args.guidance_scale;
        if (args.num_inference_steps) input.num_inference_steps = args.num_inference_steps;
        if (args.seed) input.seed = args.seed;

        try {
          // Check if model has a version hash
          let endpoint: string;
          let body: Record<string, unknown>;

          if (modelId.includes(':')) {
            // Full model:version format
            const [, version] = modelId.split(':');
            endpoint = '/predictions';
            body = { version, input };
          } else {
            // Official model format
            endpoint = `/models/${modelId}/predictions`;
            body = { input };
          }

          const { status, data } = await apiRequest('POST', endpoint, cred, body);

          if (status === 201 || status === 200) {
            // May need polling
            let pred = data as { id: string; status: string; output: unknown; error?: string; urls?: { get: string } };

            if (pred.status !== 'succeeded') {
              pred = await pollPrediction(pred.id, cred);
            }

            if (pred.status === 'failed') {
              return `Error: Generation failed: ${pred.error || 'unknown error'}`;
            }

            if (pred.status !== 'succeeded') {
              return `Error: Generation ${pred.status}`;
            }

            // Download output images
            const output = pred.output;
            const urls: string[] = Array.isArray(output) ? output as string[] : typeof output === 'string' ? [output] : [];

            if (!urls.length) return 'Error: no images in output';

            const saved: string[] = [];
            for (const url of urls) {
              if (typeof url === 'string' && url.startsWith('http')) {
                const filePath = await downloadImage(url, outputDir, 'replicate');
                saved.push(filePath);
              }
            }

            return `Generated ${saved.length} image(s) with ${modelKey}:\n${saved.map(p => `  ${p}`).join('\n')}`;
          }

          // Error
          const errData = data as { detail?: string; error?: string };
          return `Error: Replicate API ${status}: ${errData.detail || errData.error || JSON.stringify(data).substring(0, 200)}`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'list_models',
      description: 'List popular image generation models available on Replicate',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (e.g., "image generation", "upscale")' },
        },
      },
      execute: async (args, cred) => {
        // Return curated list + optional search
        const builtIn = [
          '  flux-pro         — black-forest-labs/flux-1.1-pro (best quality, ~10s)',
          '  flux-schnell     — black-forest-labs/flux-schnell (fast, ~2s)',
          '  sdxl             — stability-ai/sdxl (classic SD)',
          '  sdxl-lightning   — bytedance/sdxl-lightning-4step (very fast)',
          '  sd3              — stability-ai/stable-diffusion-3',
        ];

        let result = `Image Generation Models (shortcuts):\n${builtIn.join('\n')}`;

        const query = args.query as string;
        if (query) {
          try {
            const { status, data } = await apiRequest('GET', `/models?query=${encodeURIComponent(query)}`, cred);
            if (status === 200) {
              const models = (data as { results: Array<{ owner: string; name: string; description: string; run_count: number }> }).results || [];
              if (models.length) {
                const lines = models.slice(0, 10).map(m =>
                  `  ${m.owner}/${m.name} — ${(m.description || '').substring(0, 60)} (${m.run_count} runs)`
                );
                result += `\n\nSearch results for "${query}":\n${lines.join('\n')}`;
              }
            }
          } catch { /* search failed, still return built-in list */ }
        }

        return result;
      },
    },
    {
      name: 'upscale',
      description: 'Upscale an image to higher resolution',
      parameters: {
        type: 'object',
        properties: {
          image: { type: 'string', description: 'Path to the image to upscale' },
          scale: { type: 'number', description: 'Upscale factor: 2 or 4 (default: 2)' },
          output_dir: { type: 'string', description: 'Directory to save the result' },
        },
        required: ['image'],
      },
      execute: async (args, cred) => {
        const imagePath = args.image as string;
        if (!imagePath) return 'Error: image path is required';
        if (!fs.existsSync(imagePath)) return `Error: image not found: ${imagePath}`;

        const scale = (args.scale as number) || 2;
        const outputDir = (args.output_dir as string) || path.dirname(imagePath);

        try {
          // Read image and convert to base64 data URI
          const imageBuffer = fs.readFileSync(imagePath);
          const ext = path.extname(imagePath).slice(1) || 'png';
          const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
          const dataUri = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

          const { status, data } = await apiRequest('POST', '/models/nightmareai/real-esrgan/predictions', cred, {
            input: {
              image: dataUri,
              scale,
              face_enhance: false,
            },
          });

          if (status !== 201 && status !== 200) {
            const errData = data as { detail?: string };
            return `Error: Replicate API ${status}: ${errData.detail || 'unknown'}`;
          }

          let pred = data as { id: string; status: string; output: unknown; error?: string };
          if (pred.status !== 'succeeded') {
            pred = await pollPrediction(pred.id, cred);
          }

          if (pred.status !== 'succeeded') {
            return `Error: Upscale ${pred.status}: ${pred.error || 'unknown'}`;
          }

          const outputUrl = typeof pred.output === 'string' ? pred.output : '';
          if (!outputUrl) return 'Error: no output from upscale model';

          const filePath = await downloadImage(outputUrl, outputDir, 'upscaled');
          return `Image upscaled ${scale}x and saved to: ${filePath}`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'remove_background',
      description: 'Remove the background from an image',
      parameters: {
        type: 'object',
        properties: {
          image: { type: 'string', description: 'Path to the image' },
          output_dir: { type: 'string', description: 'Directory to save the result' },
        },
        required: ['image'],
      },
      execute: async (args, cred) => {
        const imagePath = args.image as string;
        if (!imagePath) return 'Error: image path is required';
        if (!fs.existsSync(imagePath)) return `Error: image not found: ${imagePath}`;

        const outputDir = (args.output_dir as string) || path.dirname(imagePath);

        try {
          const imageBuffer = fs.readFileSync(imagePath);
          const ext = path.extname(imagePath).slice(1) || 'png';
          const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
          const dataUri = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

          const { status, data } = await apiRequest('POST', '/models/cjwbw/rembg/predictions', cred, {
            input: { image: dataUri },
          });

          if (status !== 201 && status !== 200) {
            const errData = data as { detail?: string };
            return `Error: Replicate API ${status}: ${errData.detail || 'unknown'}`;
          }

          let pred = data as { id: string; status: string; output: unknown; error?: string };
          if (pred.status !== 'succeeded') {
            pred = await pollPrediction(pred.id, cred);
          }

          if (pred.status !== 'succeeded') {
            return `Error: Background removal ${pred.status}: ${pred.error || 'unknown'}`;
          }

          const outputUrl = typeof pred.output === 'string' ? pred.output : '';
          if (!outputUrl) return 'Error: no output from model';

          const filePath = await downloadImage(outputUrl, outputDir, 'nobg');
          return `Background removed and saved to: ${filePath}`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ];

  async validate(credential: string): Promise<boolean> {
    try {
      const { status } = await apiRequest('GET', '/account', credential);
      return status === 200;
    } catch {
      return false;
    }
  }
}
