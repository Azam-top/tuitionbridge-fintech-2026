import type { AppConfig } from "../config.js";
import { AnthropicLlm } from "./anthropic-llm.js";
import { MockLlm } from "./mock-llm.js";
import type { LlmClient } from "./types.js";

/** LIVE only when both key and model are configured; otherwise a clearly labeled MOCK. */
export function createLlm(config: AppConfig): LlmClient {
  if (config.llmApiKey && config.llmModel) return new AnthropicLlm(config.llmApiKey, config.llmModel, undefined, config.llmBaseUrl ?? undefined);
  return new MockLlm();
}
