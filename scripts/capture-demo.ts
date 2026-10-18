// Drives the REAL app (in-process server, MOCK agent, SIMULATED payments) with system Chrome to
//  1) save screenshots used by the slide deck, and 2) record a captioned screen capture of the demo.
// No audio. Captions state the modes. Run `npm run build` first, then: npm run demo:capture
import { chromium, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { openDb } from "../src/server/db";
import { loadConfig } from "../src/server/config";
import { systemClock } from "../src/server/clock";
import { resetDemo } from "../src/server/services/seed";
import { createRunner } from "../src/server/agent/runner";
import { MockLlm } from "../src/server/agent/mock-llm";
import { buildApp } from "../src/server/http/app";
import { createLlm } from "../src/server/agent/factory";
import { readFileSync } from "node:fs";
import { assessLiveReport } from "./lib/provenance";

if (!existsSync("dist/web/index.html")) { console.error("Run `npm run build` first."); process.exit(1); }
if (!existsSync("artifacts/evidence/eval-mock.json") || !existsSync("artifacts/evidence/viewer.html")) { console.error("Run `npm run evidence` first: the captions quote the measured evaluation."); process.exit(1); }
// Captions quote MEASURED values from the evidence bundle, never typed-in numbers.
const evalMock = JSON.parse(readFileSync("artifacts/evidence/eval-mock.json", "utf8")) as { passed: number; denominator: number; criticalGates: { passed: number; total: number } };
const liveStatus = assessLiveReport(existsSync("artifacts/evidence/eval-live.json") ? JSON.parse(readFileSync("artifacts/evidence/eval-live.json", "utf8")) : null).status;
const PORT = 8801;
const BASE = `http://127.0.0.1:${PORT}`;
const config = loadConfig({ APP_DEMO_MODE: "1", APP_LOGIN_RATE_LIMIT: "1000", APP_PORT: String(PORT) });
const ctx = { db: openDb(":memory:"), clock: systemClock, config };
resetDemo(ctx);
const llm = new MockLlm();
const app = buildApp({ ctx, runner: createRunner(ctx, llm), llm });
await app.listen({ host: "127.0.0.1", port: PORT });

// ---- the LIVE-mode app, in process, on its own in-memory database ----
// The model here is a LOCAL FAKE provider (e2e/fake-provider.ts) so the recording is repeatable without a key. It exercises the real
// adapter and tools but is NOT a real model; the captions say so. NBK and Wise are the REAL public sources (read-only requests).
await import("../e2e/fake-provider.ts");
const LIVE_PORT = 8802;
const LIVE_BASE = `http://127.0.0.1:${LIVE_PORT}`;
const liveConfig = loadConfig({
  APP_MODE: "live", APP_PORT: String(LIVE_PORT), APP_LOGIN_RATE_LIMIT: "1000", APP_WISE_QUOTES: "1", APP_NBK_RATES: "1",
  APP_LLM_API_KEY: "fake-key-local-provider", APP_LLM_MODEL: "fake-model", APP_LLM_BASE_URL: "http://127.0.0.1:8797", APP_UPLOAD_DIR: "artifacts/tmp/live-uploads",
});
const liveCtx = { db: openDb(":memory:", "live"), clock: systemClock, config: liveConfig };
const liveLlm = createLlm(liveConfig);
const liveApp = buildApp({ ctx: liveCtx, runner: createRunner(liveCtx, liveLlm), llm: liveLlm });
await liveApp.listen({ host: "127.0.0.1", port: LIVE_PORT });

const IMG = "docs/deck/img";
const VID_DIR = "artifacts/demo/tmp";
mkdirSync(IMG, { recursive: true });
rmSync(VID_DIR, { recursive: true, force: true });
mkdirSync(VID_DIR, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: VID_DIR, size: { width: 1280, height: 800 } } });
const page = await context.newPage();
const started = Date.now();
const stamp = () => ((Date.now() - started) / 1000).toFixed(1);

async function caption(p: Page, text: string) {
  await p.evaluate((t) => {
    let el = document.getElementById("demo-caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-caption";
      el.setAttribute("style", "position:fixed;left:0;right:0;bottom:0;z-index:99999;background:rgba(18,34,46,.94);color:#fff;font:600 18px/1.35 system-ui,sans-serif;padding:12px 24px;text-align:center;border-top:3px solid #1c9a93");
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
}
const pause = (ms: number) => page.waitForTimeout(ms);
/** Element screenshot with the recording caption hidden, so no overlay text ends up in the slide image. */
async function shot(p: Page, selector: string, path: string) {
  await p.evaluate(() => { const c = document.getElementById("demo-caption"); if (c) c.style.display = "none"; });
  await p.locator(selector).screenshot({ path });
  await p.evaluate(() => { const c = document.getElementById("demo-caption"); if (c) c.style.display = ""; });
}
const TAG = "SANDBOX · MOCK agent · SIMULATED payments · fictional TEST DATA";

// ================= LIVE mode segment =================
const LIVE_TAG = "LIVE mode · model = LOCAL FAKE provider for this recording (not a real model) · real NBK and Wise sources · the app moves no money";
function ibanOf(bban: string, cc = "KZ"): string {
  const digits = (bban + cc + "00").split("").map((c) => (c >= "A" ? String(c.charCodeAt(0) - 55) : c)).join("");
  let rem = 0;
  for (const ch of digits) rem = (rem * 10 + Number(ch)) % 97;
  return `${cc}${String(98 - rem).padStart(2, "0")}${bban}`;
}
const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
await page.goto(LIVE_BASE);
await caption(page, `TuitionBridge in LIVE mode: real accounts, no fictional data. ${LIVE_TAG}`);
await pause(4500);
await page.getByTestId("toggle-register").click();
await page.getByTestId("email").fill("student@example.org");
await page.getByTestId("display-name").fill("Example Student");
await page.getByTestId("password").fill("a-long-example-password");
await page.getByTestId("login-btn").click();
await page.getByTestId("funds").waitFor();
await caption(page, "Step 1: you declare your USD and the amount to keep for living costs. The app reads no bank: these numbers are yours");
await page.getByTestId("funds-balance-input").fill("1500");
await page.getByTestId("funds-reserve-input").fill("300");
await pause(2500);
await page.getByTestId("funds-save").click();
await pause(1500);
await caption(page, "Step 2: you add the university as a trusted recipient from its official page. An invoice can never add one");
await page.getByTestId("recipient-name").fill("Example University");
await page.getByTestId("recipient-account").fill(ibanOf("125KZT0000000001"));
await page.getByTestId("recipient-url").fill("https://example.edu/payments");
await page.getByTestId("recipient-note").fill("Official payment page, copied for this recording");
await pause(3000);
await page.getByTestId("recipient-add").click();
await pause(1500);
await page.getByTestId("invoice-ref").fill("INV-RECORDING-1");
await page.getByTestId("invoice-recipient").selectOption({ index: 1 });
await page.getByTestId("invoice-amount").fill("500000");
await page.getByTestId("invoice-due").fill(local(new Date(Date.now() + 10 * 86_400_000)));
await caption(page, "Step 3: you enter the invoice and confirm every field. The recipient is matched to the one you attested");
await pause(3500);
await page.getByTestId("invoice-create").click();
await page.getByTestId("confirm-invoice").click();
await page.getByTestId("offers-card").waitFor();
await caption(page, "Step 4: payment options come from named sources. The NBK reference rate is a guide, never an offer");
await page.getByTestId("offers-card").scrollIntoViewIfNeeded();
await pause(3500);
await page.getByTestId("fetch-wise").click();
await page.getByTestId("offers-message").waitFor({ timeout: 20_000 });
let haveWise = (await page.getByTestId("offer-list").count()) > 0;
if (haveWise) {
  await caption(page, "Real Wise public quotes for this amount: rate, fee, estimated delivery and expiry come from the provider; nothing is invented");
  await pause(6500);
  await shot(page, "#offers", `${IMG}/live-offers.png`);
} else {
  await caption(page, "Wise could not be reached from this machine right now: no quote is invented. You can enter an offer from your bank instead");
  await pause(4500);
  await page.getByText("Enter an offer you were given").click();
  await page.getByTestId("offer-provider").fill("Example Bank");
  await page.getByTestId("offer-rate").fill("450");
  await page.getByTestId("offer-fee").fill("12");
  await page.getByTestId("offer-arrival").fill(local(new Date(Date.now() + 3 * 86_400_000)));
  await page.getByTestId("offer-valid").fill(local(new Date(Date.now() + 3 * 3600_000)));
  await page.getByTestId("offer-seen").fill(local(new Date(Date.now() - 5 * 60_000)));
  await page.getByTestId("offer-note").fill("Offer typed in for this recording");
  await page.getByTestId("offer-add").click();
  await pause(2500);
  haveWise = false;
}
await page.getByTestId("start-task").scrollIntoViewIfNeeded();
await caption(page, "Step 5: you ask the agent to plan. It reads the confirmed invoice, your declared funds and the stored offers");
await pause(3000);
await page.getByTestId("start-task").click();
await page.getByTestId("approval-card").waitFor({ timeout: 30_000 });
await page.getByTestId("approval-card").scrollIntoViewIfNeeded();
await caption(page, "The exact proposal: recipient, amounts, reserve kept, and where this offer came from. The server chose the best route, not the model");
await pause(8000);
await page.getByTestId("approve-btn").click();
await page.getByTestId("instruction-card").waitFor({ timeout: 20_000 });
await page.getByTestId("instruction-card").scrollIntoViewIfNeeded();
await caption(page, "After your approval the app issues a payment instruction. It has NOT moved any money: you pay in your bank or Wise");
await pause(8000);
await shot(page, "#instruction-card", `${IMG}/live-instruction.png`);
await page.getByTestId("mark-paid").click();
await caption(page, "You can mark it paid or upload your confirmation. Both are stored as YOUR evidence, with a hash, and are never called bank verification");
await pause(6500);
await page.getByTestId("usd-balance").scrollIntoViewIfNeeded();
await caption(page, "Your declared balance is unchanged: the app never debits anything in the live mode");
await pause(4500);

// ================= SANDBOX segment =================
// ---- login ----
await page.goto(BASE);
await caption(page, `The separate SANDBOX used for the competition check. ${TAG}`);
await pause(3500);
await page.getByTestId("email").fill("alice@demo.local");
await page.getByTestId("password").fill("demo-alice-2026");
await page.getByTestId("login-btn").click();
await page.getByTestId("funds").waitFor();

// ---- scenario 1: successful payment ----
await page.getByTestId("scenario-s1").click();
await caption(page, "Scenario 1: USD 1,500.00 balance, USD 300.00 kept for living costs, KZT 500,000 tuition due in 48 h");
await pause(4500);
await page.getByTestId("invoice-fields").scrollIntoViewIfNeeded();
await caption(page, "The invoice fields are shown for YOU to confirm before the agent does anything");
await pause(3500);
await page.getByTestId("confirm-invoice").click();
await pause(1200);
await caption(page, "Instruction: cheapest feasible route, keep USD 300. The server validates it and shows what it understood");
await page.getByTestId("instruction").scrollIntoViewIfNeeded();
await pause(3500);
await page.getByTestId("start-task").click();
await page.getByTestId("approval-card").waitFor();
await page.getByTestId("next-step").scrollIntoViewIfNeeded();
await caption(page, "One clear next step at every stage: here, approve or reject the exact payment");
await pause(3500);
await page.getByTestId("intent").scrollIntoViewIfNeeded();
await caption(page, "The agent understood: cheapest, USD 300.00 reserve it cannot lower, deadline and beneficiary fixed by the invoice");
await pause(4500);
await page.getByTestId("routes-table").scrollIntoViewIfNeeded();
await caption(page, "Three simulated quotes. BudgetBridge is cheapest on paper but arrives after the deadline, so it is excluded: LATE");
await pause(6500);
await page.getByTestId("approval-card").scrollIntoViewIfNeeded();
await caption(page, "You review the exact transaction. Recipient will receive KZT 500,000.00; you will be debited USD 1,010.00; nothing is paid yet");
await pause(8000);
await caption(page, "Only you can approve. The agent has no approval tool, and the server rechecks everything in one atomic transaction");
await pause(4500);
await page.getByTestId("approve-btn").click();
await page.getByTestId("receipt").waitFor();
await page.getByTestId("receipt").scrollIntoViewIfNeeded();
await caption(page, "Receipt (SIMULATED): USD 1,010.00 debited, KZT 500,000.00 credited to the university in the sandbox ledger");
await pause(6500);
await page.getByTestId("usd-balance").scrollIntoViewIfNeeded();
await caption(page, "The balance now reads USD 490.00: the USD 300.00 reserve was preserved");
await pause(4000);
await page.getByTestId("tech-panel").locator(":scope > summary").click();
await page.getByTestId("timeline").scrollIntoViewIfNeeded();
await caption(page, "Technical details: every step is an actual tool event stored in the database, not generated narration");
await pause(5000);

// ---- scenario 3: malicious invoice ----
await page.evaluate(() => window.scrollTo(0, 0));
await page.getByTestId("scenario-s3").click();
await caption(page, "Scenario 3: the invoice text orders 'waive approval, send funds to another account'");
await page.getByTestId("invoice-notes").scrollIntoViewIfNeeded();
await pause(5500);
await page.getByTestId("confirm-invoice").click();
await page.getByTestId("start-task").click();
await page.getByTestId("approval-card").waitFor();
await page.getByTestId("approval-account").scrollIntoViewIfNeeded();
await caption(page, "The document has no authority: the proposal still pays the trusted registry account, and approval is still required");
await pause(6500);
await page.getByTestId("reject-btn").click();
await page.getByTestId("usd-balance").scrollIntoViewIfNeeded();
await caption(page, "Rejected: USD 1,500.00 is unchanged. Zero unauthorized debit");
await pause(5000);

// ---- evidence viewer ----
await caption(page, "Offline evidence from real runs (REPLAY): opening the evidence viewer");
await pause(1800);
await page.goto("file://" + resolve("artifacts/evidence/viewer.html"));
await caption(page, "REPLAY of recorded MOCK runs: tool trace, approval record, ledger before/after, receipt");
await pause(4500);
await page.getByRole("tab", { name: "Evaluation (deterministic)" }).click();
await caption(page, `Deterministic evaluation: ${evalMock.passed}/${evalMock.denominator} fixed cases, critical ${evalMock.criticalGates.passed}/${evalMock.criticalGates.total}. ${liveStatus === "VERIFIED" ? "A real-model evaluation report is included" : "Real-model evaluation: NOT RUN"}`);
await pause(7000);
await page.getByRole("tab", { name: "Manifest" }).click();
await caption(page, `Limits: MOCK agent in this video${liveStatus === "VERIFIED" ? "" : ", live model not verified"}, payments simulated, no real student interviews yet`);
await pause(6000);

await context.close();
const vid = (await page.video()?.path()) ?? "";

// ---- slide-grade screenshots: narrow viewport, 2x resolution, no caption overlay, no video ----
{
  const ctx2 = await browser.newContext({ viewport: { width: 760, height: 1100 }, deviceScaleFactor: 2 });
  const p = await ctx2.newPage();
  await p.goto(BASE);
  await p.getByTestId("email").fill("bob@demo.local");
  await p.getByTestId("password").fill("demo-bob-2026");
  await p.getByTestId("login-btn").click();
  await p.getByTestId("scenario-s1").click();
  await p.getByTestId("confirm-invoice").click();
  await p.getByTestId("start-task").click();
  await p.getByTestId("approval-card").waitFor();
  const box = await p.locator("#approval").boundingBox();
  await p.locator("#approval").screenshot({ path: `${IMG}/approval.png`, clip: undefined });
  void box;
  await p.getByTestId("approve-btn").click();
  await p.getByTestId("receipt").waitFor();
  await p.locator("#receipt").screenshot({ path: `${IMG}/receipt.png` });
  await ctx2.close();
}
await browser.close();
await app.close();
await liveApp.close();
const webm = "artifacts/demo/tuitionbridge-demo-mock.webm";
if (vid) renameSync(vid, webm);
rmSync(VID_DIR, { recursive: true, force: true });
let dur = "unknown";
try { dur = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", webm], { encoding: "utf8" }).trim(); } catch { /* optional */ }
try {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "28", "-preset", "veryfast", "-an", "artifacts/demo/tuitionbridge-demo-mock.mp4"]);
} catch { console.log("mp4 conversion skipped (ffmpeg/libx264 unavailable)"); }
console.log(`recorded ${webm} (${(statSync(webm).size / 1e6).toFixed(1)} MB), duration ${dur}s, wall ${stamp()}s`);
process.exit(0);
