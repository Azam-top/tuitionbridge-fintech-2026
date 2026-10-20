// Runs the unit/integration and browser suites and writes MEASURED totals to artifacts/evidence/test-summary.json.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gitInfo } from "./lib/provenance";

const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const TMP = "artifacts/tmp";
mkdirSync(TMP, { recursive: true });

const tc = run("npx", ["tsc", "--noEmit"]);
run("npx", ["vitest", "run", "--reporter=json", `--outputFile=${TMP}/vitest.json`]);
const vj = JSON.parse(readFileSync(`${TMP}/vitest.json`, "utf8")) as { numTotalTests: number; numPassedTests: number; numFailedTests: number; numTotalTestSuites: number; testResults: unknown[] };
spawnSync("npx", ["playwright", "test", "--reporter=json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: `${TMP}/pw.json` } });
const ej = JSON.parse(readFileSync(`${TMP}/pw.json`, "utf8")) as { stats: { expected: number; unexpected: number; flaky: number; skipped: number } };
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

const summary = {
  generatedAt: new Date().toISOString(), node: process.version, projectVersion: pkg.version,
  sourceCommit: gitInfo().head, sourceDirty: gitInfo().dirty,
  typecheck: tc.status === 0 ? "pass" : "FAIL",
  unitAndIntegration: { files: vj.testResults.length, total: vj.numTotalTests, passed: vj.numPassedTests, failed: vj.numFailedTests },
  browser: { runner: "Playwright + system Google Chrome", total: ej.stats.expected + ej.stats.unexpected + ej.stats.flaky + ej.stats.skipped, passed: ej.stats.expected, failed: ej.stats.unexpected, flaky: ej.stats.flaky, skipped: ej.stats.skipped },
};
mkdirSync("artifacts/evidence", { recursive: true });
writeFileSync("artifacts/evidence/test-summary.json", JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
process.exit(tc.status === 0 && summary.unitAndIntegration.failed === 0 && summary.browser.failed === 0 ? 0 : 1);
