import { LlmError, type ChatMessage, type LlmClient, type LlmRequest, type LlmTurn, type ToolCall } from "./types.js";

/**
 * Adapter for OpenAI-compatible Chat Completions endpoints with function tool calling (used for Groq).
 * - Plain fetch: no extra dependency. The key is sent only in the Authorization header of the server-side request.
 * - Retries are owned by the runner (bounded); this adapter never retries and never switches provider or model.
 * - Hidden reasoning is never requested back (include_reasoning=false), never logged, never echoed.
 * - Provider failures are classified into sanitized LlmError messages: no request body, header or key is ever included.
 */
export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
/** A 429 asking us to wait longer than this is reported as a limit (daily quota etc.) instead of being waited out. */
export const MAX_RETRY_AFTER_MS = 30_000;

export interface OpenAiCompatibleOptions {
  baseUrl?: string;
  timeoutMs?: number;
  reasoningEffort?: "low" | "medium" | "high" | null;
  providerLabel?: string;
}

interface WireToolCall { id?: unknown; type?: unknown; function?: { name?: unknown; arguments?: unknown } }
interface WireResponse {
  choices?: { finish_reason?: unknown; message?: { content?: unknown; tool_calls?: unknown } }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

export class OpenAiCompatibleLlm implements LlmClient {
  readonly mode = "LIVE" as const;
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly label: string;

  constructor(private readonly apiKey: string, readonly model: string, private readonly opts: OpenAiCompatibleOptions = {}) {
    this.url = `${(opts.baseUrl ?? GROQ_BASE_URL).replace(/\/+$/, "")}/chat/completions`;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.label = opts.providerLabel ?? "Model provider";
  }

  async complete(req: LlmRequest): Promise<LlmTurn> {
    const body = {
      model: this.model,
      messages: toWireMessages(req),
      tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
      tool_choice: "auto",
      max_completion_tokens: req.maxTokens,
      include_reasoning: false,
      ...(this.opts.reasoningEffort ? { reasoning_effort: this.opts.reasoningEffort } : {}),
    };
    let res: Response;
    try {
      res = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "error", // never follow a redirect with the Authorization header
      });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new LlmError(timedOut ? `${this.label} did not answer within ${Math.round(this.timeoutMs / 1000)} s.` : `Could not reach ${this.label} (network error).`, true);
    }
    let text: string;
    try {
      text = await res.text();
    } catch {
      throw new LlmError(`${this.label} response was interrupted.`, true);
    }
    if (!res.ok) throw this.httpError(res, text);
    return this.parse(text);
  }

  private httpError(res: Response, text: string): LlmError {
    const s = res.status;
    let code = "";
    try { code = String((JSON.parse(text) as { error?: { code?: unknown } }).error?.code ?? ""); } catch { /* body is not JSON */ }
    if (s === 429) {
      const secs = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(secs) && secs >= 0 ? Math.ceil(secs * 1000) : null;
      if (wait !== null && wait > MAX_RETRY_AFTER_MS) {
        return new LlmError(`${this.label} rate limit reached (HTTP 429); it asks to wait ${Math.ceil(wait / 1000)} s. Try again later.`, false, 429);
      }
      return new LlmError(`${this.label} rate limit (HTTP 429).`, true, 429, wait ?? undefined);
    }
    // A tool call the model could not produce in valid form is non-deterministic: a bounded retry is reasonable.
    const toolFailed = (s === 400 && code === "tool_use_failed") || s === 422;
    const transient = toolFailed || s === 408 || s === 409 || s >= 500;
    return new LlmError(`${this.label} returned HTTP ${s}${toolFailed ? " (the model produced an invalid tool call)" : ""}.`, transient, s);
  }

  private parse(text: string): LlmTurn {
    let json: WireResponse;
    try { json = JSON.parse(text) as WireResponse; } catch { throw new LlmError(`${this.label} returned a response that is not valid JSON.`, true); }
    const choice = json.choices?.[0];
    const msg = choice?.message;
    if (!choice || !msg || typeof msg !== "object") throw new LlmError(`${this.label} returned a response without a message.`, true);
    const content = typeof msg.content === "string" ? msg.content.trim() : "";
    const wire = Array.isArray(msg.tool_calls) ? (msg.tool_calls as WireToolCall[]) : [];
    const toolCalls: ToolCall[] = wire.map((c, i) => {
      const name = typeof c.function?.name === "string" ? c.function.name : "";
      const id = typeof c.id === "string" && c.id ? c.id : `call_${i}`;
      return { id, name, input: parseArguments(c.function?.arguments) };
    });
    const fr = choice.finish_reason;
    const stop: LlmTurn["stop"] =
      toolCalls.length ? "tool_use" : fr === "length" ? "max_tokens" : fr === "content_filter" ? "refusal" : fr === "stop" ? "end" : "other";
    const pt = json.usage?.prompt_tokens;
    const ct = json.usage?.completion_tokens;
    const usage = typeof pt === "number" && typeof ct === "number" ? { inputTokens: pt, outputTokens: ct } : null;
    return { text: content, toolCalls, stop, usage };
  }
}

/** Arguments arrive as a JSON string. Anything that is not a JSON object is passed on as a string so the tool's own validation rejects it. */
function parseArguments(a: unknown): unknown {
  if (a === undefined || a === null || a === "") return {};
  if (typeof a !== "string") return a;
  try {
    const v: unknown = JSON.parse(a);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? v : a;
  } catch {
    return a;
  }
}

function toWireMessages(req: LlmRequest): unknown[] {
  const out: unknown[] = [{ role: "system", content: req.system }];
  for (const m of req.messages as ChatMessage[]) {
    if (m.role === "user") out.push({ role: "user", content: m.text });
    else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.text || null,
        ...(m.toolCalls.length
          ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: typeof c.input === "string" ? "{}" : JSON.stringify(c.input ?? {}) } })) }
          : {}),
      });
    } else {
      for (const r of m.results) out.push({ role: "tool", tool_call_id: r.id, name: r.name, content: r.content });
    }
  }
  return out;
}
