export interface ImageAttachment {
  data: string;        // base64-encoded image data
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: ImageAttachment[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResult {
  tool_call_id: string;
  content: string;
  is_error?: boolean;
}

/**
 * Optional callbacks for streaming-capable tools. Tools that implement
 * `stream()` emit stdout/stderr chunks through these callbacks instead
 * of buffering. Transport-agnostic by design — an HTTP/SSE bridge lives
 * in the caller, not the tool.
 */
export interface ToolStreamEvents {
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
}

export interface ToolStreamResult {
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
  timedOut: boolean;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  permission: 'auto' | 'prompt' | 'always-ask';
  cacheable?: boolean;
  execute(args: Record<string, unknown>): Promise<string>;
  /**
   * Optional streaming entry point. Implementers MUST re-run the same
   * preflight/validation as `execute()` inside `stream()` — the caller's
   * gate chain runs first, but the tool must defend itself independently
   * against the "gated, then walked around the fence" pattern.
   */
  stream?(
    args: Record<string, unknown>,
    events: ToolStreamEvents,
    opts?: { timeoutMs?: number },
  ): Promise<ToolStreamResult>;
}

export interface ProviderConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export interface LLMProvider {
  name: string;
  temperature?: number;
  chat(messages: Message[], tools?: ToolSchema[]): AsyncGenerator<StreamEvent>;
  listModels?(): Promise<string[]>;
}

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface StreamEvent {
  type: 'text' | 'thinking' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_end' | 'usage' | 'done' | 'error';
  text?: string;
  toolCall?: Partial<ToolCall>;
  error?: string;
  usage?: UsageStats;
}

export interface UsageStats {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

export interface AgentEvent {
  type: 'thinking' | 'text' | 'tool_call' | 'tool_result' | 'done' | 'error' | 'compaction' | 'usage' | 'stream_progress' | 'spark_state';
  text?: string;
  toolCall?: { name: string; args: Record<string, unknown> };
  toolResult?: { name: string; result: string; is_error?: boolean };
  error?: string;
  usage?: UsageStats;
  risk?: { score: number; level: string };
  streamProgress?: { tokensGenerated: number; tokensPerSecond: number; elapsedMs: number };
  sparkState?: { emotion: any; personality: any };
}

export interface Config {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
  maxIterations: number;
  autoApprove: boolean;
  contextBudget?: number;
  projectRoot?: string;
}
