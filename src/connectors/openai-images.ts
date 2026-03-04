/**
 * OpenAI Images Connector — DALL-E 3 / GPT-Image
 *
 * Auth: OPENAI_API_KEY (same key used for chat, works for images too)
 * Actions: generate, edit, variations
 */

import * as fs from 'fs';
import * as path from 'path';
import { Connector, ConnectorAction } from './base';

const BASE_URL = 'https://api.openai.com/v1';
const TIMEOUT = 60_000; // Image generation can be slow
const MAX_RESPONSE = 10_000;

async function apiRequest(
  endpoint: string,
  credential: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credential}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json();
    return { status: res.status, data };
  } catch (err: unknown) {
    clearTimeout(timer);
    throw err;
  }
}

function formatError(status: number, data: unknown): string {
  if (typeof data === 'object' && data && 'error' in data) {
    const err = (data as { error: { message: string } }).error;
    return `Error: OpenAI API ${status}: ${err.message}`;
  }
  return `Error: OpenAI API ${status}`;
}

/** Save base64 image data to file, return the path */
function saveImage(b64Data: string, outputDir: string, prefix: string, format: string): string {
  fs.mkdirSync(outputDir, { recursive: true });
  const timestamp = Date.now();
  const filename = `${prefix}-${timestamp}.${format}`;
  const filePath = path.join(outputDir, filename);
  const buffer = Buffer.from(b64Data, 'base64');
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

export class OpenAIImagesConnector implements Connector {
  name = 'openai_images';
  displayName = 'OpenAI Images';
  description = 'Generate and edit images using DALL-E 3 and GPT-Image models.';
  authType: Connector['authType'] = 'api_key';
  envKey = 'OPENAI_API_KEY';

  actions: ConnectorAction[] = [
    {
      name: 'generate',
      description: 'Generate an image from a text prompt using DALL-E 3',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Text description of the image to generate' },
          size: { type: 'string', description: 'Image size: 1024x1024, 1792x1024, or 1024x1792 (default: 1024x1024)' },
          quality: { type: 'string', description: 'Quality: standard or hd (default: standard)' },
          style: { type: 'string', description: 'Style: vivid or natural (default: vivid)' },
          model: { type: 'string', description: 'Model: dall-e-3 or dall-e-2 (default: dall-e-3)' },
          output_dir: { type: 'string', description: 'Directory to save the image (default: current directory)' },
          n: { type: 'number', description: 'Number of images (1 for dall-e-3, up to 10 for dall-e-2)' },
        },
        required: ['prompt'],
      },
      execute: async (args, cred) => {
        const prompt = args.prompt as string;
        if (!prompt) return 'Error: prompt is required';

        const model = (args.model as string) || 'dall-e-3';
        const size = (args.size as string) || '1024x1024';
        const quality = (args.quality as string) || 'standard';
        const style = (args.style as string) || 'vivid';
        const n = Math.min((args.n as number) || 1, model === 'dall-e-3' ? 1 : 10);
        const outputDir = (args.output_dir as string) || process.cwd();

        const body: Record<string, unknown> = {
          model,
          prompt,
          n,
          size,
          response_format: 'b64_json',
        };
        if (model === 'dall-e-3') {
          body.quality = quality;
          body.style = style;
        }

        try {
          const { status, data } = await apiRequest('/images/generations', cred, body);
          if (status !== 200) return formatError(status, data);

          const result = data as { data: Array<{ b64_json: string; revised_prompt?: string }> };
          if (!result.data?.length) return 'Error: no images returned';

          const saved: string[] = [];
          for (let i = 0; i < result.data.length; i++) {
            const img = result.data[i];
            const filePath = saveImage(img.b64_json, outputDir, 'generated', 'png');
            saved.push(filePath);
          }

          const revisedPrompt = result.data[0].revised_prompt;
          const lines = [`Generated ${saved.length} image(s):`];
          for (const p of saved) lines.push(`  ${p}`);
          if (revisedPrompt) lines.push(`\nRevised prompt: ${revisedPrompt}`);
          return lines.join('\n');
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'edit',
      description: 'Edit an existing image using a text prompt (inpainting). Requires a source image.',
      parameters: {
        type: 'object',
        properties: {
          image: { type: 'string', description: 'Path to the source image (PNG, must be square, max 4MB)' },
          mask: { type: 'string', description: 'Path to the mask image (PNG with transparency showing where to edit)' },
          prompt: { type: 'string', description: 'Text description of the desired edit' },
          size: { type: 'string', description: 'Output size: 256x256, 512x512, or 1024x1024 (default: 1024x1024)' },
          output_dir: { type: 'string', description: 'Directory to save the result' },
        },
        required: ['image', 'prompt'],
      },
      execute: async (args, cred) => {
        const imagePath = args.image as string;
        const prompt = args.prompt as string;
        if (!imagePath || !prompt) return 'Error: image path and prompt are required';
        if (!fs.existsSync(imagePath)) return `Error: image not found: ${imagePath}`;

        const size = (args.size as string) || '1024x1024';
        const outputDir = (args.output_dir as string) || path.dirname(imagePath);

        try {
          // Use FormData for multipart upload
          const formData = new FormData();
          const imageBuffer = fs.readFileSync(imagePath);
          formData.append('image', new Blob([imageBuffer], { type: 'image/png' }), path.basename(imagePath));
          formData.append('prompt', prompt);
          formData.append('model', 'dall-e-2');
          formData.append('size', size);
          formData.append('response_format', 'b64_json');

          if (args.mask) {
            const maskPath = args.mask as string;
            if (fs.existsSync(maskPath)) {
              const maskBuffer = fs.readFileSync(maskPath);
              formData.append('mask', new Blob([maskBuffer], { type: 'image/png' }), path.basename(maskPath));
            }
          }

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), TIMEOUT);
          const res = await fetch(`${BASE_URL}/images/edits`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${cred}` },
            body: formData,
            signal: controller.signal,
          });
          clearTimeout(timer);

          if (!res.ok) {
            const data = await res.json();
            return formatError(res.status, data);
          }

          const result = await res.json() as { data: Array<{ b64_json: string }> };
          if (!result.data?.length) return 'Error: no images returned';

          const filePath = saveImage(result.data[0].b64_json, outputDir, 'edited', 'png');
          return `Image edited and saved to: ${filePath}`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'variation',
      description: 'Generate variations of an existing image',
      parameters: {
        type: 'object',
        properties: {
          image: { type: 'string', description: 'Path to the source image (PNG, must be square, max 4MB)' },
          n: { type: 'number', description: 'Number of variations (1-10, default: 1)' },
          size: { type: 'string', description: 'Output size: 256x256, 512x512, or 1024x1024 (default: 1024x1024)' },
          output_dir: { type: 'string', description: 'Directory to save results' },
        },
        required: ['image'],
      },
      execute: async (args, cred) => {
        const imagePath = args.image as string;
        if (!imagePath) return 'Error: image path is required';
        if (!fs.existsSync(imagePath)) return `Error: image not found: ${imagePath}`;

        const n = Math.min((args.n as number) || 1, 10);
        const size = (args.size as string) || '1024x1024';
        const outputDir = (args.output_dir as string) || path.dirname(imagePath);

        try {
          const formData = new FormData();
          const imageBuffer = fs.readFileSync(imagePath);
          formData.append('image', new Blob([imageBuffer], { type: 'image/png' }), path.basename(imagePath));
          formData.append('model', 'dall-e-2');
          formData.append('n', String(n));
          formData.append('size', size);
          formData.append('response_format', 'b64_json');

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), TIMEOUT);
          const res = await fetch(`${BASE_URL}/images/variations`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${cred}` },
            body: formData,
            signal: controller.signal,
          });
          clearTimeout(timer);

          if (!res.ok) {
            const data = await res.json();
            return formatError(res.status, data);
          }

          const result = await res.json() as { data: Array<{ b64_json: string }> };
          if (!result.data?.length) return 'Error: no images returned';

          const saved: string[] = [];
          for (const img of result.data) {
            const filePath = saveImage(img.b64_json, outputDir, 'variation', 'png');
            saved.push(filePath);
          }
          return `Generated ${saved.length} variation(s):\n${saved.map(p => `  ${p}`).join('\n')}`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ];

  async validate(credential: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(`${BASE_URL}/models`, {
        headers: { 'Authorization': `Bearer ${credential}` },
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.status === 200;
    } catch {
      return false;
    }
  }
}
