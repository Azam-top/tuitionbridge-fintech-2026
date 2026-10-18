import { defineConfig } from "@playwright/test";

// Uses the system Google Chrome (channel "chrome"); no browser download needed.
// Two app servers on non-default ports, each with a fresh on-disk database:
//   sandbox  (8799): fictional TEST DATA + the labeled MOCK agent        -> e2e/flow.spec.ts
//   live     (8798): the real mode with a model served by a LOCAL FAKE provider (8797) -> e2e/live.spec.ts
const common = "APP_LOGIN_RATE_LIMIT=1000 APP_TASK_RATE_LIMIT=1000 APP_MUTATE_RATE_LIMIT=10000";
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { channel: "chrome", headless: true, trace: "retain-on-failure" },
  projects: [
    { name: "sandbox", testMatch: "flow.spec.ts", use: { baseURL: "http://127.0.0.1:8799" } },
    { name: "live", testMatch: "live.spec.ts", use: { baseURL: "http://127.0.0.1:8798" } },
  ],
  webServer: [
    {
      command: `rm -f data/e2e.sqlite* && APP_MODE=sandbox APP_PORT=8799 APP_DB_PATH=data/e2e.sqlite APP_UPLOAD_DIR=data/e2e-uploads-sandbox ${common} APP_LLM_API_KEY= APP_LLM_MODEL= node --import tsx src/server/index.ts`,
      url: "http://127.0.0.1:8799/api/config", reuseExistingServer: false, timeout: 60_000,
    },
    {
      command: "node --import tsx e2e/fake-provider.ts",
      url: "http://127.0.0.1:8797/health", reuseExistingServer: false, timeout: 30_000,
    },
    {
      command: `rm -rf data/e2e-live.sqlite* data/e2e-uploads-live && APP_MODE=live APP_PORT=8798 APP_DB_PATH=data/e2e-live.sqlite APP_UPLOAD_DIR=data/e2e-uploads-live APP_WISE_QUOTES=0 APP_NBK_RATES=0 ${common} APP_LLM_API_KEY=fake-key-local-provider APP_LLM_MODEL=fake-model APP_LLM_BASE_URL=http://127.0.0.1:8797 node --import tsx src/server/index.ts`,
      url: "http://127.0.0.1:8798/api/config", reuseExistingServer: false, timeout: 60_000,
    },
  ],
});
