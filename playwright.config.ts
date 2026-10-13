import { defineConfig } from "@playwright/test";

// Uses the system Google Chrome (channel "chrome"); no browser download needed.
// The test server runs a fresh on-disk DB with the deterministic MOCK agent on a non-default port.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:8799", channel: "chrome", headless: true, trace: "retain-on-failure" },
  webServer: {
    command: "rm -f data/e2e.sqlite* && APP_PORT=8799 APP_DB_PATH=data/e2e.sqlite APP_DEMO_MODE=1 APP_LOGIN_RATE_LIMIT=1000 APP_LLM_API_KEY= APP_LLM_MODEL= node --import tsx src/server/index.ts",
    url: "http://127.0.0.1:8799/api/config",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
