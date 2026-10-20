// Builds the final presentation from MEASURED files and the project documents:
//   docs/deck/index.html                       editable source (HTML + img/, keyboard navigation, notes with N)
//   docs/deck/TuitionBridge_Presentation.pdf   the file for submission: 10 slides, 16:9, no notes
//   docs/deck/TuitionBridge_Speaker_Notes.md   speaker notes in plain English (about 9 minutes)
//   docs/deck/TuitionBridge_Project_Summary_RU.md   short project summary in Russian for the presenter
// Inputs: artifacts/evidence/{eval-mock,test-summary}.json, tests/fixtures (a recorded Wise response), docs/LIVE_SMOKE_RESULT.md,
// docs/MANUAL_PASS.md and the screenshots saved by `npm run demo:capture` (docs/deck/img).   npm run deck
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { formatKzt, formatUsd } from "../src/shared/money";
import { parseWiseQuote } from "../src/server/services/offers";
import { assessLiveReport } from "./lib/provenance";

// ------------------------------------------------------------------ measured inputs
const evalMock = JSON.parse(readFileSync("artifacts/evidence/eval-mock.json", "utf8")) as {
  passed: number; denominator: number; criticalGates: { passed: number; total: number }; unauthorizedSuccessfulPayments: number; generatedAt: string;
};
const tests = JSON.parse(readFileSync("artifacts/evidence/test-summary.json", "utf8")) as {
  unitAndIntegration: { total: number; passed: number; files: number }; browser: { total: number; passed: number };
};
const liveEval = assessLiveReport(existsSync("artifacts/evidence/eval-live.json") ? JSON.parse(readFileSync("artifacts/evidence/eval-live.json", "utf8")) : null);
if (liveEval.status === "VERIFIED") throw new Error("A verified live evaluation exists: update this presentation's evidence slide before building it.");

// The two scripted real-model runs are recorded in docs/LIVE_SMOKE_RESULT.md; the figures used below must still be there.
const smokeDoc = readFileSync("docs/LIVE_SMOKE_RESULT.md", "utf8");
for (const needle of ['"inputTokens": 9296', '"outputTokens": 553', '"inputTokens": 4920', '"outputTokens": 429', "NOT PASSED"]) {
  if (!smokeDoc.includes(needle)) throw new Error(`docs/LIVE_SMOKE_RESULT.md no longer contains ${needle}; update the evidence slide before building.`);
}
const manualDone = !/Status: NOT YET DONE/.test(readFileSync("docs/MANUAL_PASS.md", "utf8"));

const e = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const TUITION = 50_000_000n;
const BALANCE = 150_000n; // USD 1,500.00 in cents
const RESERVE = 30_000n; // USD 300.00
const wiseJson = JSON.parse(readFileSync("tests/fixtures/wise-quote-usd-kzt.recorded-2026-10-20.json", "utf8")) as { createdTime: string };
const snapshot = new Date(wiseJson.createdTime);
const snapshotText = `${snapshot.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}, ${snapshot.toISOString().slice(11, 16)} UTC`;
const METHOD: Record<string, string> = { "wise:BANK_TRANSFER": "Bank transfer", "wise:DEBIT": "Debit card", "wise:CREDIT": "Credit card" };
const options = parseWiseQuote(wiseJson, TUITION).filter((o) => METHOD[o.providerId]).sort((a, b) => BigInt(a.providerAmounts!.sourceTotalCents) < BigInt(b.providerAmounts!.sourceTotalCents) ? -1 : 1);
if (options.length !== 3) throw new Error("expected the three Wise payment methods in the recorded response");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const rows = options.map((o, i) => {
  const total = BigInt(o.providerAmounts!.sourceTotalCents);
  const left = BALANCE - total;
  if (left < RESERVE) throw new Error("the example must keep the reserve in every row");
  return `<tr class="${i === 0 ? "best" : ""}"><td class="nw"><strong>${METHOD[o.providerId]}</strong>${i === 0 ? '<span class="pill">Lowest total</span>' : ""}</td><td class="num"><strong>${formatUsd(total)}</strong></td><td class="num">${formatUsd(o.feeCents)}</td><td class="num">${formatKzt(o.providerAmounts!.targetTiyn)}</td><td class="nw">${day(o.estArrivalAt)}</td><td class="num">${formatUsd(left)}</td></tr>`;
}).join("");

const img = (name: string) => { if (!existsSync(`docs/deck/img/${name}`)) throw new Error(`docs/deck/img/${name} is missing: run npm run demo:capture first`); return `img/${name}`; };

// ------------------------------------------------------------------ slides
const ICON: Record<string, string> = {
  coins: '<ellipse cx="12" cy="7" rx="6.5" ry="2.8"/><path d="M5.5 7v5c0 1.5 2.9 2.8 6.5 2.8s6.5-1.3 6.5-2.8V7M5.5 12v5c0 1.5 2.9 2.8 6.5 2.8s6.5-1.3 6.5-2.8v-5"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M8 3.5v4M16 3.5v4M4 10.5h16"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 016.5 5H18v3"/><rect x="3.5" y="7.5" width="17" height="12" rx="2.5"/><path d="M16 13.5h2.5"/>',
  spark: '<path d="M12 4l1.7 5.1L19 11l-5.3 1.9L12 18l-1.7-5.1L5 11l5.3-1.9L12 4z"/>',
  doc: '<path d="M7 3.5h7l4 4V20a.5.5 0 01-.5.5h-10.5a.5.5 0 01-.5-.5V4a.5.5 0 01.5-.5z"/><path d="M14 3.5V8h4M9.5 12.5h5M9.5 16h5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.5"/><path d="M8 10.5V8a4 4 0 018 0v2.5"/>',
  shield: '<path d="M12 3.5l7 2.6v5.4c0 4.2-2.9 7.4-7 9-4.1-1.6-7-4.8-7-9V6.1l7-2.6z"/><path d="M9 12l2.2 2.2L15.2 10"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
};
const icon = (n: string) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
const LOGO = '<svg class="logo" viewBox="0 0 44 36" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="TuitionBridge"><path d="M3 6h19M12.5 6v24"/><path d="M27 6v24M27 6h6.5a6 6 0 010 12H27M27 18h7.5a6 6 0 010 12H27"/></svg>';

interface Slide { title: string; kicker?: string; html: string; notes: string; seconds: number; cls?: string }
const S: Slide[] = [
  { title: "TuitionBridge", cls: "cover", seconds: 30,
    html: `<div class="cover-mark">${LOGO}</div><p class="cover-sub">Tuition payment planning for international students</p>`,
    notes: "Hello. This is TuitionBridge. It helps an international student plan a tuition payment. It compares ways to pay, checks the deadline, and keeps the student's living money safe. In the next nine minutes I will show the problem, the product, how the AI and the server share the work, and what we have and have not proven." },
  { title: "Paying tuition means balancing four things", kicker: "The student's payment problem", seconds: 50,
    html: `<div class="tiles four">
      <div class="tile">${icon("doc")}<h3>The amount</h3><p>Tuition is billed in tenge.</p></div>
      <div class="tile">${icon("coins")}<h3>The full cost</h3><p>Rate and fees decide what you pay in dollars.</p></div>
      <div class="tile">${icon("calendar")}<h3>The deadline</h3><p>Money must arrive before it, not just be sent.</p></div>
      <div class="tile">${icon("wallet")}<h3>Money to live on</h3><p>Rent and food must stay covered.</p></div></div>
      <p class="foot">This is our understanding of the problem. No student interviews have been run yet.</p>`,
    notes: "Imagine a student who has dollars and a tuition invoice in tenge. They must think about four things at once. The amount. The full cost, because the rate and the fees change what they pay. The deadline, because the money must arrive in time, not only be sent. And their living money, because rent and food still need to be paid. Today these checks are done by hand. To be clear: this is our understanding of the problem. We have not interviewed students yet, and we do not show any statistics." },
  { title: "TuitionBridge shows the full picture before you pay", kicker: "How TuitionBridge helps", seconds: 55,
    html: `<div class="tiles four">
      <div class="tile">${icon("coins")}<h3>Full cost</h3><p>One total in dollars, fee included.</p></div>
      <div class="tile">${icon("clock")}<h3>Timing</h3><p>Expected arrival compared with the invoice deadline.</p></div>
      <div class="tile">${icon("shield")}<h3>Reserve kept</h3><p>Your living money stays untouched.</p></div>
      <div class="tile">${icon("spark")}<h3>Clear reason</h3><p>Why this option, and why the others were not chosen.</p></div></div>
      <p class="foot">These are the benefits we designed for. We have not measured time or money saved.</p>`,
    notes: "TuitionBridge puts the answers in one place. First, the full cost: one total in dollars with the fee included. Second, timing: the expected arrival date next to the invoice deadline. Third, the reserve: the student chooses how much to keep for living costs, and every recommendation respects it. Fourth, a short reason for the recommendation, and the reasons other options were not chosen. These are the benefits we built for. We have not measured savings, and we do not claim any. The explanation matters because a student should be able to check the answer, not just trust it. If the student changes the goal or the reserve, the plan updates, and the numbers update with it." },
  { title: "From invoice to payment", kicker: "The payment journey", seconds: 50,
    html: `<ol class="journey">
      <li><span>1</span>Add your invoice</li><li><span>2</span>Check the fields</li><li><span>3</span>Compare options</li>
      <li><span>4</span>Review the plan</li><li class="hl"><span>5</span>You approve</li><li><span>6</span>Continue on Wise</li></ol>
      <p class="line">TuitionBridge prepares the plan. You approve it. The provider moves the money.</p>`,
    notes: "The journey has six steps. The student adds the invoice, by hand or from a text PDF, and checks every field. TuitionBridge then collects current options and compares them. The student reviews one clear plan. Step five is the important one: only the student can approve. Then the student continues on the provider's own site, here Wise, and completes the payment there. TuitionBridge does not move money. At any point the student can stop. Nothing is paid until they act at the provider, and the app never has access to the student's bank." },
  { title: "The working product", kicker: "Live screen", seconds: 60, cls: "shotslide",
    html: `<div class="shotrow"><div class="bigshot"><img src="${img("live-plan.png")}" alt="TuitionBridge live screen: funds and reserve, transfer options, and the recommendation"/>
      <span class="bd" style="left:8px;top:18px">1</span><span class="bd" style="left:8px;top:245px">2</span><span class="bd" style="left:760px;top:52px">3</span></div>
      <ol class="legend"><li><span>1</span>Funds, reserve and money left for tuition</li><li><span>2</span>Options with total, fee and arrival</li><li><span>3</span>One recommendation with its reason</li></ol></div>
      <p class="foot">Screenshot of the running app, 20 October 2026. Real Wise quotes and a local test model. Quotes change by the minute.</p>`,
    notes: "This is the live product. Look at the three numbers. Number one: the student's funds, the living reserve, and how much is available for tuition. These numbers are entered by the student. The app does not read the bank. Number two: the transfer options, each with the total, the fee and the expected arrival. Number three: one recommendation with a short reason. Here it says the lowest total among three options that arrive by the deadline and keep the three hundred dollar reserve. This screenshot comes from the running app on the twentieth of October. The quotes are real Wise quotes. The assistant in this recording is a local test model, not a real AI model. Quotes change by the minute, so the numbers here differ a little from the next slide." },
  { title: "One example: three ways to pay with Wise", kicker: "A route comparison", seconds: 65,
    html: `<p class="lead small">Tuition KZT 500,000.00 · funds USD 1,500.00 · living reserve USD 300.00</p>
      <table class="routes"><colgroup><col style="width:27%"><col style="width:16%"><col style="width:12%"><col style="width:19%"><col style="width:10%"><col style="width:16%"></colgroup><thead><tr><th>Payment method</th><th>You pay</th><th>Fee</th><th>University receives</th><th>Arrives</th><th>Left after paying</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="foot">Wise quote snapshot: ${e(snapshotText)}. Amounts are as Wise quoted them and are not guaranteed. All three are payment methods of one provider. Each keeps the USD 300.00 reserve.</p>`,
    notes: `Here is one documented example. The tuition is five hundred thousand tenge. The student has fifteen hundred dollars and keeps three hundred for living costs. These are three payment methods of one provider, Wise. The bank transfer has the lowest total, ${formatUsd(options[0].providerAmounts!.sourceTotalCents)}, and the lowest fee. The card options cost more but arrive earlier. Every option leaves the full reserve untouched. The quotes were taken on ${snapshotText}. They change by the minute and Wise does not guarantee them, so this is an example, not a promise. Look at the last column. After paying, the student still has at least three hundred dollars in every case, and the table shows how much more is left with the cheaper option.` },
  { title: "The AI explains. The server decides.", kicker: "The AI's role", seconds: 55,
    html: `<div class="split">
      <div class="side"><h3>AI assistant</h3><ul><li>Understands your request</li><li>Uses the tools to read the invoice, funds and quotes</li><li>Explains the recommendation in plain words</li></ul></div>
      <div class="side acc"><h3>Server</h3><ul><li>Checks every amount</li><li>Applies the deadline, funds and reserve</li><li>Ranks the options</li><li>Accepts approval only from you</li></ul></div></div>
      <p class="line">The AI cannot approve a payment or change an amount.</p>`,
    notes: "The AI has a clear, limited job. It reads what the student asks, for example lowest cost and keep three hundred dollars. It uses tools to read the invoice, the funds and the quotes. And it explains the result in plain words. The server does everything that involves money. It checks every amount, applies the deadline, the funds and the reserve, and ranks the options. The AI cannot approve a payment and cannot change an amount. If its text does not match the stored records, the app does not show it. This split is the main safety idea. A language model can make mistakes, so we never let it handle money directly. The numbers come from code that we test." },
  { title: "Approval is tied to the exact plan", kicker: "Approval and payment safety", seconds: 60, cls: "approval",
    html: `<div class="two"><div class="bigshot narrow"><img src="${img("live-approval.png")}" alt="The review and approve card with the recipient, account, amounts and timing"/></div>
      <ul class="points"><li><strong>Exact figures.</strong> Your approval covers these amounts. If anything changes, you approve again.</li>
      <li><strong>Fresh offers only.</strong> An expired offer cannot be approved.</li>
      <li><strong>Server checks.</strong> The server re-checks everything. You finish the payment at the provider.</li></ul></div>`,
    notes: "This is the review card. It shows the full recipient and account, the exact amounts, the deadline, the expected arrival and how long the offer is valid. When the student approves, the approval is tied to exactly these figures. If anything changes, a new plan needs a new approval. An expired offer cannot be approved, and the server checks it again at the end. After approval the student gets a payment instruction, and completes the payment at the provider. A mark or a file the student adds is only their own record. It is never presented as bank confirmation." },
  { title: "Evidence and current limits", kicker: "What we measured, and what we did not", seconds: 70,
    html: `<div class="tiles three">
      <div class="tile"><h3>Automated checks</h3><p class="big">${tests.unitAndIntegration.passed}<small>/${tests.unitAndIntegration.total}</small></p><p>unit and integration tests pass</p><p class="big2">${tests.browser.passed}<small>/${tests.browser.total}</small></p><p>browser tests pass (test model)</p></div>
      <div class="tile"><h3>Sandbox evaluation</h3><p class="big">${evalMock.passed}<small>/${evalMock.denominator}</small></p><p>fixed cases pass, ${evalMock.criticalGates.passed}/${evalMock.criticalGates.total} critical, ${evalMock.unauthorizedSuccessfulPayments} unauthorized payments</p><p class="muted">Test data and a stand-in AI. It checks the server rules, not a real model.</p></div>
      <div class="tile"><h3>Real model runs</h3><ul class="runs"><li><strong>Run 1 passed</strong> (script, test student, older version)</li><li><strong>Run 2 failed</strong> (Wise rounding; now fixed, not re-run)</li><li><strong>${manualDone ? "Manual pass recorded" : "Manual pass with a real invoice: not done yet"}</strong></li></ul></div></div>
      <p class="warnline">Not a full live test. Not bank-certified. Not production-ready.</p>`,
    notes: `Here is what we measured, in three groups. Automated checks: ${tests.unitAndIntegration.passed} of ${tests.unitAndIntegration.total} unit and integration tests pass, and ${tests.browser.passed} of ${tests.browser.total} browser tests pass. The browser tests use a test model. Sandbox evaluation: ${evalMock.passed} of ${evalMock.denominator} fixed cases pass, all ${evalMock.criticalGates.total} critical cases, and zero unauthorized payments. This uses test data and a stand-in AI, so it checks our server rules, not a real model. Real model runs: the first scripted run passed with a test student. The second failed because Wise rounds its displayed rate. We fixed that, but we have not re-run it on a real model. ${manualDone ? "A manual pass is recorded in the project files." : "A manual pass with a real invoice is not done yet."} So this is not a full live test. We do not claim bank certification or production readiness.` },
  { title: "Next steps", kicker: "What comes next", seconds: 45,
    html: `<ol class="next"><li><strong>Test with students.</strong> Run a small pilot and learn what really helps.</li>
      <li><strong>Check demand.</strong> Ask students and universities if they would use it.</li>
      <li><strong>Finish the real-model checks.</strong> A manual pass with a real invoice and the live evaluation.</li>
      <li><strong>Add a second AI option.</strong> Gemini is planned. It is not built or tested yet.</li></ol>
      <p class="line big-line">Every student sees the full cost, the arrival date and a safe reserve before they pay.</p>`,
    notes: "What comes next. First, a small pilot with students, to learn what really helps. Second, a check of demand with students and universities. Third, we finish the real-model checks: a manual pass with a real invoice, and the live evaluation. Fourth, we plan to add a second AI option, Gemini. That is only a plan. It is not built or tested. Our goal is simple: before any student pays, they see the full cost, the arrival date and a safe reserve. Thank you." },
];

const total = S.reduce((a, s) => a + s.seconds, 0);
const words = S.reduce((a, s) => a + s.notes.split(/\s+/).length, 0);
if (S.length !== 10) throw new Error("the presentation must have 10 slides");
if (total < 480 || total > 560) throw new Error(`timing ${total}s is outside 8 to 9 minutes`);

const css = `
:root{--bg:#171A17;--card:#222722;--line:rgba(243,244,236,.12);--text:#F3F4EC;--muted:#A8AE9F;--accent:#D5E66B;--warn:#E9BE5A}
*{box-sizing:border-box}html,body{margin:0;background:#0d0f0d;color:var(--text);font:22px/1.4 Inter,"Inter Tight",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.stage{position:fixed;inset:0;display:grid;place-items:center;overflow:hidden}
.slide{display:none;position:relative;width:1280px;height:720px;flex:none;background:var(--bg);padding:58px 84px 52px;overflow:hidden;transform-origin:center center}
.slide.active{display:block}
.kicker{margin:0 0 14px;font-size:15px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:600}
h1{margin:0 0 26px;font-size:50px;line-height:1.12;letter-spacing:-.025em;font-weight:650;max-width:1120px}
h3{margin:14px 0 6px;font-size:26px;font-weight:600;letter-spacing:-.01em}
p{margin:0}.muted{color:var(--muted)}.foot{position:absolute;left:84px;right:84px;bottom:50px;color:var(--muted);font-size:17px}
.num{font-variant-numeric:tabular-nums}.logo{width:150px;height:auto;color:var(--accent)}.ic{width:40px;height:40px;color:var(--accent)}
.pn{position:absolute;right:40px;bottom:26px;color:rgba(168,174,159,.6);font-size:14px}
.cover{padding-top:200px}.cover h1{font-size:104px;letter-spacing:-.04em;margin:0 0 22px;max-width:none}
.cover-mark{position:absolute;left:84px;top:70px}.cover-sub{font-size:34px;color:var(--muted);max-width:760px;line-height:1.25}
.cover:after{content:"";position:absolute;left:84px;bottom:84px;width:120px;height:4px;border-radius:2px;background:var(--accent)}
.tiles{display:grid;gap:22px;margin-top:6px}.tiles.four{grid-template-columns:repeat(4,1fr)}.tiles.three{grid-template-columns:repeat(3,1fr)}
.tile{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:30px 26px;min-height:300px}.tile p{color:var(--muted);font-size:21px}
.tiles.three .tile{padding:26px 24px;min-height:360px}.tiles.three .tile p{font-size:19px}
.tiles .tile p.big{font-size:68px;font-weight:650;letter-spacing:-.03em;color:var(--text)!important;line-height:1.05;margin:4px 0 2px}.tiles .tile p.big small{font-size:32px;color:var(--muted)}
.tiles .tile p.big2{font-size:46px;font-weight:650;letter-spacing:-.03em;color:var(--text)!important;line-height:1.05;margin:14px 0 2px}.tiles .tile p.big2 small{font-size:24px;color:var(--muted)}.tiles.three .tile p.big,.tiles.three .tile p.big2{color:var(--text)}.tiles.three .tile p.big{font-size:68px}.tiles.three .tile p.big2{font-size:46px}.tiles.three .tile p.muted{margin-top:14px}
.runs{margin:6px 0 0;padding-left:20px;color:var(--muted);font-size:19px}.runs li{margin:12px 0}.runs strong{color:var(--text)}
.warnline{position:absolute;left:84px;right:84px;bottom:46px;padding:14px 22px;border:1px solid rgba(233,190,90,.5);border-radius:14px;background:rgba(233,190,90,.1);color:#F3E2B0;font-size:22px;font-weight:600;text-align:center}
.journey{list-style:none;margin:56px 0 0;padding:0;display:grid;grid-template-columns:repeat(6,1fr);gap:14px}
.journey li{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px 16px;min-height:250px;font-size:25px;font-weight:600;display:flex;flex-direction:column;gap:22px}
.journey li span{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;border:1.5px solid var(--accent);color:var(--accent);font-size:20px}
.journey li.hl{background:var(--accent);color:#171A17;border-color:var(--accent)}.journey li.hl span{background:#171A17;color:var(--accent);border-color:#171A17}
.line{margin-top:60px;font-size:30px;line-height:1.3;max-width:1112px}.big-line{font-size:34px;color:var(--accent);margin-top:40px}
.bigshot{position:relative;border-radius:18px;overflow:hidden;border:1px solid var(--line);background:#101310}.bigshot img{display:block;width:100%}
.shotslide h1{margin-bottom:18px}.shotslide .foot{bottom:20px}
.shotrow{display:grid;grid-template-columns:840px 1fr;gap:40px;align-items:start}.shotrow .bigshot{height:452px}.shotrow .bigshot img{width:840px}
.bd{position:absolute;width:30px;height:30px;border-radius:50%;background:var(--accent);color:#171A17;display:grid;place-items:center;font-size:17px;font-weight:700;box-shadow:0 3px 12px rgba(0,0,0,.5)}
.legend{list-style:none;margin:0;padding:0;display:grid;gap:34px;font-size:23px;line-height:1.3}.legend li{display:grid;grid-template-columns:34px 1fr;gap:12px;align-items:start}
.legend span{width:30px;height:30px;border-radius:50%;background:var(--accent);color:#171A17;display:grid;place-items:center;font-size:17px;font-weight:700}
table.routes{width:100%;border-collapse:collapse;margin-top:14px;font-size:22px;table-layout:fixed}table.routes td.num,table.routes td.nw{white-space:nowrap}table.routes th{padding:10px 12px;text-align:left;color:var(--muted);font-size:16px;letter-spacing:.06em;text-transform:uppercase;font-weight:600;border-bottom:1px solid var(--line)}
table.routes td{padding:22px 12px;border-bottom:1px solid var(--line)}table.routes tr.best{background:rgba(213,230,107,.12)}
.pill{margin-left:10px;padding:3px 9px;border-radius:999px;background:var(--accent);color:#171A17;font-size:13px;font-weight:650;vertical-align:middle;white-space:nowrap}
.lead.small{font-size:23px;color:var(--muted);margin-top:-6px}
.split{display:grid;grid-template-columns:1fr 1fr;gap:26px;margin-top:6px}.side{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:30px 32px;min-height:330px}
.side.acc{border-color:rgba(213,230,107,.55)}.side h3{margin-top:0;color:var(--accent);font-size:30px}.side ul{margin:14px 0 0;padding-left:24px;font-size:25px}.side li{margin:14px 0}
.approval .two{display:grid;grid-template-columns:520px 1fr;gap:44px;align-items:start}.bigshot.narrow img{width:100%}
.points{margin:0;padding:0;list-style:none;font-size:26px;display:grid;gap:26px}.points strong{color:var(--accent)}
.next{margin:10px 0 0;padding-left:34px;font-size:27px;max-width:1040px}.next li{margin:16px 0}.next strong{color:var(--accent)}
.notes{display:none}
@page{size:1280px 720px;margin:0}
@media print{html,body{background:var(--bg);height:auto}.stage{position:static;display:block;overflow:visible}.slide{display:block!important;position:relative;transform:none!important;page-break-after:always;break-after:page;margin:0}.bar,#notes{display:none!important}}
.bar{position:fixed;left:0;right:0;bottom:0;display:flex;justify-content:space-between;padding:6px 16px;background:#0d0f0d;color:#8d948a;font-size:13px;z-index:5}
#notes{position:fixed;left:0;right:0;bottom:30px;max-height:34vh;overflow:auto;padding:14px 22px;background:#12150f;border-top:2px solid var(--accent);color:#d9dcd0;font-size:16px;display:none;z-index:4}
body.show-notes #notes{display:block}`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TuitionBridge</title><style>${css}</style></head><body>
<div class="stage" id="stage">
${S.map((s, i) => `<section class="slide ${s.cls ?? ""}" id="s${i + 1}" aria-label="Slide ${i + 1} of ${S.length}">${s.kicker ? `<p class="kicker">${e(s.kicker)}</p>` : ""}<h1>${e(s.title)}</h1>${s.html}${i > 0 ? `<span class="pn">${i + 1}</span>` : ""}</section>`).join("\n")}
</div>
<div id="notes" aria-live="polite"></div>
<div class="bar"><span>← → navigate · N notes · Home / End</span><span id="pos"></span></div>
<script>
const NOTES=${JSON.stringify(S.map((s) => `(${s.seconds} s) ${s.notes}`))};
const slides=[...document.querySelectorAll(".slide")];let i=0;
function fit(){const k=Math.min(innerWidth/1280,(innerHeight-30)/720);slides.forEach(s=>s.style.transform="scale("+k+")")}
function show(n){i=Math.max(0,Math.min(slides.length-1,n));slides.forEach((s,k)=>s.classList.toggle("active",k===i));document.getElementById("pos").textContent=(i+1)+" / "+slides.length;document.getElementById("notes").textContent=NOTES[i];history.replaceState(null,"","#"+(i+1));}
document.addEventListener("keydown",(e)=>{if(["ArrowRight","PageDown"," "].includes(e.key)){e.preventDefault();show(i+1)}else if(["ArrowLeft","PageUp"].includes(e.key)){e.preventDefault();show(i-1)}else if(e.key==="Home")show(0);else if(e.key==="End")show(slides.length-1);else if(e.key.toLowerCase()==="n")document.body.classList.toggle("show-notes");});
addEventListener("resize",fit);fit();show((parseInt(location.hash.slice(1))||1)-1);
</script></body></html>`;
writeFileSync("docs/deck/index.html", html);

// ------------------------------------------------------------------ speaker notes (plain English) and the Russian summary
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
let at = 0;
const notesMd = `# TuitionBridge: speaker notes

About ${mmss(total)} in total (${words} words at a calm pace). Use short sentences and pause on the numbers. Everything on the slides is true today; if a fact changes, rebuild the deck (\`npm run deck\`) and re-read slides 5, 6 and 9.

${S.map((s, i) => { const from = at; at += s.seconds; return `## Slide ${i + 1}: ${s.title}\n*${mmss(from)} to ${mmss(at)} (${s.seconds} s)*\n\n${s.notes}\n`; }).join("\n")}
## If you are asked
- **Did you test with students?** No. The problem statement is our understanding. We have run no interviews yet.
- **Does it move money?** No. It prepares a plan and a payment instruction. The student completes the payment at the provider.
- **Is the AI safe to trust?** The AI cannot approve a payment or change an amount. The server checks the money, the deadline and the reserve.
- **Did a real AI model pass?** One scripted run passed on an older version and one failed because of Wise rounding. That is fixed, but not re-run on a real model. A manual pass with a real invoice ${manualDone ? "is recorded in the project files" : "is not done yet"}.
- **Is it bank-certified or ready for production?** No.
- **Gemini?** A planned second AI option. Not built or tested.
`;
writeFileSync("docs/deck/TuitionBridge_Speaker_Notes.md", notesMd);

const ruMd = `# TuitionBridge: краткое объяснение проекта (для подготовки к выступлению)

Файл собирается автоматически вместе с презентацией (\`npm run deck\`), числа взяты из последних отчётов.

## Что это
TuitionBridge помогает иностранному студенту спланировать оплату обучения в тенге, когда деньги у него в долларах. Приложение сравнивает способы оплаты, проверяет срок поступления относительно дедлайна инвойса и сохраняет резерв на жизнь. Деньги приложение **не двигает**: оно готовит план и платёжную инструкцию, а студент завершает оплату у провайдера (сейчас это Wise).

## Как это работает (по шагам)
1. Студент вводит свои доллары и резерв, добавляет счёт университета с его официальной страницы, вводит инвойс и подтверждает поля.
2. По кнопке «Plan my payment» сервер сам получает актуальные котировки Wise и курс Нацбанка РК (как ориентир).
3. ИИ понимает просьбу («самый дешёвый, оставь 300 USD»), вызывает инструменты и объясняет результат простыми словами.
4. **Сервер** проверяет все суммы, срок, баланс и резерв, ранжирует варианты и выбирает лучший. ИИ не может одобрить платёж или изменить сумму.
5. Студент лично одобряет точный план. Одобрение привязано к этим суммам (хеш), срок котировки проверяется повторно.
6. Кнопка «Continue on Wise» ведёт на wise.com. Оплата завершается там.

## Пример на слайде 6
Тенговая сумма 500 000, у студента 1 500 USD, резерв 300 USD. Снимок котировок Wise: ${snapshotText}. Три способа оплаты одного провайдера:
${options.map((o) => `- ${METHOD[o.providerId]}: платит ${formatUsd(o.providerAmounts!.sourceTotalCents)}, комиссия ${formatUsd(o.feeCents)}, университет получает ${formatKzt(o.providerAmounts!.targetTiyn)}, прибытие ${day(o.estArrivalAt)}`).join("\n")}
Котировки меняются каждую минуту и не гарантированы: это пример, а не обещание.

## Что измерено (слайд 9)
- Автоматические проверки: ${tests.unitAndIntegration.passed} из ${tests.unitAndIntegration.total} unit/integration и ${tests.browser.passed} из ${tests.browser.total} браузерных тестов прошли (в браузерных тестах используется тестовая модель).
- Оценка в sandbox: ${evalMock.passed} из ${evalMock.denominator} фиксированных случаев, критических ${evalMock.criticalGates.passed} из ${evalMock.criticalGates.total}, неавторизованных платежей ${evalMock.unauthorizedSuccessfulPayments}. Это тестовые данные и подставной ИИ: проверяются правила сервера, а не поведение настоящей модели.
- Настоящая модель: прогон 1 прошёл (скрипт, тестовый студент, старая версия: 9 296 токенов на входе, 553 на выходе). Прогон 2 не прошёл из-за округления курса Wise (4 920 и 429 токенов): ошибку исправили, но на настоящей модели повторно не запускали. Ручной проход с настоящим инвойсом: ${manualDone ? "записан в docs/MANUAL_PASS.md" : "ещё не сделан"}.

## Чего мы не утверждаем
- Не было интервью со студентами, статистики нет, экономию времени и денег не измеряли.
- Это не полный LIVE-тест, нет банковской сертификации, не готово к production.
- Gemini: только план (не реализовано и не проверено).
- Реального исполнения платежа нет: только инструкция и переход на Wise.

## Вероятные вопросы и короткие ответы
- *Почему агент, а не форма?* Агент понимает свободную просьбу и объясняет результат; все деньги и ограничения проверяет сервер, поэтому ошибка модели не приводит к платежу.
- *Что если Wise недоступен?* Приложение так и скажет и предложит повторить или ввести предложение своего банка вручную. Ничего не придумывается.
- *Чем отличается sandbox от live?* Sandbox: вымышленные данные и подставной ИИ для проверки жюри. Live: ваши данные и реальные источники.
- *Что дальше?* Пилот со студентами, проверка спроса, завершение проверок на настоящей модели, затем второй вариант ИИ (Gemini).
`;
writeFileSync("docs/deck/TuitionBridge_Project_Summary_RU.md", ruMd);

console.log(`deck: ${S.length} slides, speaker time ${mmss(total)}, notes ${words} words`);

// ------------------------------------------------------------------ PDF (slides only)
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto("file://" + resolve("docs/deck/index.html"));
await page.emulateMedia({ media: "print" });
await page.pdf({ path: "docs/deck/TuitionBridge_Presentation.pdf", width: "1280px", height: "720px", printBackground: true });
await browser.close();
console.log("PDF: docs/deck/TuitionBridge_Presentation.pdf");
