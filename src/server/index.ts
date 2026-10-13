import { existsSync } from "node:fs";
import { loadConfig, agentMode } from "./config.js";
import { openDb } from "./db.js";
import { systemClock } from "./clock.js";
import { createLlm } from "./agent/factory.js";
import { createRunner } from "./agent/runner.js";
import { buildApp } from "./http/app.js";
import { resetDemo } from "./services/seed.js";

// Optional project-local .env (server-only). ANTHROPIC_API_KEY is deliberately never read.
if (existsSync(".env")) process.loadEnvFile(".env");
const config = loadConfig();
const loopback = ["127.0.0.1", "::1", "localhost"];
if (!loopback.includes(config.host) && process.env.APP_ALLOW_REMOTE !== "1") {
  console.error(`Refusing to bind ${config.host}: this demo binds to loopback only. Set APP_ALLOW_REMOTE=1 to override (not recommended).`);
  process.exit(1);
}
const db = openDb(config.dbPath);
const ctx = { db, clock: systemClock, config };
const hasUsers = (db.prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c > 0;
if (!hasUsers) {
  resetDemo(ctx);
  console.log("Seeded synthetic demo dataset.");
}
const llm = createLlm(config);
const runner = createRunner(ctx, llm);
runner.recoverInterrupted();
const app = buildApp({ ctx, runner, llm });
await app.listen({ host: config.host, port: config.port });
console.log(`TuitionBridge on http://${config.host}:${config.port}  agent=${agentMode(config)}  payments=SIMULATED${config.demoMode ? "  demo=on" : ""}`);
if (agentMode(config) === "MOCK") console.log("No APP_LLM_API_KEY/APP_LLM_MODEL set: using the deterministic MOCK agent (not a live model run).");
