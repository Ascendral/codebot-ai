/**
 * KlomboAGI Provider — the reasoning engine as an LLM provider.
 *
 * This is NOT an LLM. It's a reasoning algorithm that learns from
 * conversation through evidence accumulation, curiosity-driven
 * exploration, and structural pattern matching.
 *
 * When selected in the dashboard, messages go through KlomboAGI's
 * cognition loop instead of Claude/GPT API calls.
 *
 * No API key needed. No cloud dependency. Runs locally.
 * Starts empty. Learns from you. Gets smarter over time.
 */

import { LLMProvider, Message, ToolSchema, StreamEvent } from '../types';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export class KlomboAGIProvider implements LLMProvider {
  name = 'klomboagi';
  temperature?: number;
  private pythonPath: string;
  private scriptPath: string;
  private memoryPath: string;

  constructor() {
    // Find Python
    this.pythonPath = 'python3';
    // The bridge script that calls KlomboAGI's conversation interface
    this.scriptPath = path.join(__dirname, '..', '..', 'klomboagi-bridge.py');
    // Persistent memory
    this.memoryPath = path.join(
      process.env.HOME || '~', '.klomboagi', 'memory.json'
    );
  }

  async *chat(messages: Message[], _tools?: ToolSchema[]): AsyncGenerator<StreamEvent> {
    // Get the last user message
    const userMessages = messages.filter(m => m.role === 'user');
    if (userMessages.length === 0) {
      yield { type: 'text', text: 'I\'m here. Teach me something or ask me a question.' };
      yield { type: 'done' };
      return;
    }

    const lastMessage = userMessages[userMessages.length - 1].content;

    yield { type: 'thinking', text: 'Reasoning...' };

    try {
      // Call KlomboAGI via Python subprocess
      const result = execFileSync(this.pythonPath, [
        '-c',
        `
import sys, json
sys.path.insert(0, '${path.resolve(__dirname, '..', '..', '..', 'KlomboAGI')}')
from klomboagi.interface.conversation import Baby
baby = Baby(memory_path='${this.memoryPath}')
response = baby.hear(${JSON.stringify(lastMessage)})
print(json.dumps({"response": response}))
`,
      ], {
        encoding: 'utf-8',
        timeout: 30_000,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      });

      // Parse the response
      const parsed = JSON.parse(result.trim());
      const response = parsed.response || 'I need to think about that more.';

      // Stream the response character by character for natural feel
      const words = response.split(' ');
      for (let i = 0; i < words.length; i++) {
        const word = (i === 0 ? '' : ' ') + words[i];
        yield { type: 'text', text: word };
        // Small delay between words for streaming effect
        await new Promise(r => setTimeout(r, 15));
      }

      yield { type: 'done' };

    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      if (error.includes('TIMEOUT')) {
        yield { type: 'text', text: 'I\'m still thinking... that question is complex. Let me try a simpler approach.' };
      } else {
        yield { type: 'text', text: `I encountered an issue: ${error.substring(0, 200)}` };
      }
      yield { type: 'done' };
    }
  }

  async listModels(): Promise<string[]> {
    return ['klomboagi'];
  }
}
