import Anthropic from "@anthropic-ai/sdk";
import { LlmError, type ChatMessage, type LlmClient, type LlmRequest, type LlmTurn } from "./types.js";

/**
 * Live adapter built on the official @anthropic-ai/sdk Messages API with client tool use.
 * - Key and model come from server-only config and are passed explicitly (ANTHROPIC_API_KEY is never read).
 * - SDK auto-retries are disabled: the runner owns the bounded retry budget.
 * - Provider thinking blocks are echoed back unchanged via `raw`, never logged or shown.
 * To use another provider, implement LlmClient and return it from createLlm().
 */
export class AnthropicLlm implements LlmClient {
  readonly mode = "LIVE" as const;
  private client: Anthropic;

  constructor(apiKey: string, readonly model: string, timeoutMs = 60_000, baseURL?: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 0, timeout: timeoutMs, ...(baseURL ? { baseURL } : {}) });
  }

  async complete(req: LlmRequest): Promise<LlmTurn> {
    let res: Anthropic.Message;
    try {
      res = await this.client.messages.create({
        model: this.model,
        max_tokens: req.maxTokens,
        system: req.system,
        tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema })),
        messages: toAnthropicMessages(req.messages),
      });
    } catch (e) {
      throw classify(e);
    }
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    const toolCalls = res.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, input: b.input }));
    const stop: LlmTurn["stop"] =
      res.stop_reason === "tool_use" ? "tool_use" : res.stop_reason === "end_turn" ? "end" : res.stop_reason === "max_tokens" ? "max_tokens"
        : res.stop_reason === "refusal" ? "refusal" : "other";
    return {
      text, toolCalls, stop, raw: res.content,
      usage: res.usage ? { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens } : null,
    };
  }
}

function toAnthropicMessages(msgs: ChatMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of msgs) {
    if (m.role === "user") out.push({ role: "user", content: m.text });
    else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: (m.raw as Anthropic.ContentBlock[] | undefined) as Anthropic.ContentBlockParam[] ??
          [
            ...(m.text ? [{ type: "text" as const, text: m.text }] : []),
            ...m.toolCalls.map((c) => ({ type: "tool_use" as const, id: c.id, name: c.name, input: c.input as Record<string, unknown> })),
          ],
      });
    } else {
      out.push({
        role: "user",
        content: m.results.map((r) => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.content, is_error: r.isError })),
      });
    }
  }
  return out;
}

/** Sanitized: never include request bodies, headers or keys in the message. */
function classify(e: unknown): LlmError {
  if (e instanceof Anthropic.APIConnectionError) return new LlmError("Could not reach the model provider (network or timeout).", true);
  if (e instanceof Anthropic.APIError) {
    const s = e.status;
    const transient = s === 429 || s === 408 || s === 409 || (typeof s === "number" && s >= 500);
    return new LlmError(`Model provider returned HTTP ${s ?? "error"}.`, transient, s);
  }
  return new LlmError("Unexpected model adapter error.", false);
}
