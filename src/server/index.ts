import { existsSync } from "node:fs";
import { loadConfig, agentStatus } from "./config.js";
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
  console.error(`Refusing to bind ${config.host}: this app binds to loopback only. Set APP_ALLOW_REMOTE=1 to override (not recommended).`);
  process.exit(1);
}
// The database file is stamped with its mode; opening a live file in sandbox mode (or the reverse) is refused.
const db = openDb(config.dbPath, config.appMode);
const ctx = { db, clock: systemClock, config };
if (config.appMode === "sandbox") {
  const hasUsers = (db.prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c > 0;
  if (!hasUsers) {
    resetDemo(ctx);
    console.log("Seeded the SANDBOX test dataset (fictional university, providers and users).");
  }
}
const llm = createLlm(config);
const runner = createRunner(ctx, llm);
runner.recoverInterrupted();
const app = buildApp({ ctx, runner, llm });
await app.listen({ host: config.host, port: config.port });
const agent = agentStatus(config);
console.log(`TuitionBridge on http://${config.host}:${config.port}  mode=${config.appMode.toUpperCase()}  agent=${agent}  db=${config.dbPath}`);
if (config.appMode === "sandbox") console.log("SANDBOX: test data only; payments are SIMULATED. This is not the real application mode.");
if (agent === "NOT_CONFIGURED") console.log("SETUP REQUIRED: set APP_LLM_API_KEY and APP_LLM_MODEL in .env. The live mode has no stand-in agent.");
if (agent === "MOCK") console.log("Sandbox agent is the deterministic MOCK stand-in (not a live model).");
