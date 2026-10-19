// Provider-neutral LLM interface. Swap the adapter without touching the runner or tools.

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultMsg {
  id: string;
  name: string;
  content: string; // JSON text
  isError: boolean;
}

export type ChatMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls: ToolCall[]; raw?: unknown }
  | { role: "tool"; results: ToolResultMsg[] };

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmTurn {
  text: string; // visible assistant text only (never hidden reasoning)
  toolCalls: ToolCall[];
  usage: LlmUsage | null; // null when the provider did not report usage (e.g. MOCK)
  stop: "end" | "tool_use" | "max_tokens" | "refusal" | "other";
  raw?: unknown; // provider-native assistant content, echoed back unchanged on the next request
}

export interface LlmRequest {
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  maxTokens: number;
}

export interface LlmClient {
  readonly mode: "LIVE" | "MOCK";
  readonly model: string | null;
  complete(req: LlmRequest): Promise<LlmTurn>;
}

/** Thrown by adapters. `transient` errors may be retried (bounded by the runner). */
export class LlmError extends Error {
  constructor(message: string, public readonly transient: boolean, public readonly status?: number, public readonly retryAfterMs?: number) {
    super(message);
    this.name = "LlmError";
  }
}
