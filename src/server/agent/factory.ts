import type { AppConfig } from "../config.js";
import { AnthropicLlm } from "./anthropic-llm.js";
import { MockLlm } from "./mock-llm.js";
import { LlmError, type LlmClient, type LlmTurn } from "./types.js";

/** Placeholder for the live mode without a model configured. The runner refuses to start a task before ever calling it. */
class UnconfiguredLlm implements LlmClient {
  readonly mode = "LIVE" as const;
  readonly model = null;
  async complete(): Promise<LlmTurn> {
    throw new LlmError("No model is configured (set APP_LLM_API_KEY and APP_LLM_MODEL).", false);
  }
}

/**
 * LIVE adapter when a key and model are configured. The labeled MOCK stand-in exists only in the sandbox;
 * the live mode never falls back to it.
 */
export function createLlm(config: AppConfig): LlmClient {
  if (config.llmApiKey && config.llmModel) return new AnthropicLlm(config.llmApiKey, config.llmModel, undefined, config.llmBaseUrl ?? undefined);
  if (config.appMode === "sandbox") return new MockLlm();
  return new UnconfiguredLlm();
}
