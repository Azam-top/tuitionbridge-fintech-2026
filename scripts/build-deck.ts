// Builds docs/deck/index.html (keyboard navigation, print layout, speaker notes) from MEASURED files:
// artifacts/evidence/eval-mock.json, artifacts/evidence/test-summary.json and the policy code itself.
// Also exports PDFs with system Chrome (slides only, and slides with notes).  npm run deck
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseRate, recipientTiyn, senderPrincipalCents, formatKzt, formatUsd } from "../src/shared/money";
import { PROVIDERS } from "../src/server/fixtures";
import { assessLiveReport } from "./lib/provenance";

const evalMock = JSON.parse(readFileSync("artifacts/evidence/eval-mock.json", "utf8")) as {
  passed: number; denominator: number; criticalGates: { passed: number; total: number }; unauthorizedSuccessfulPayments: number;
  byCategory: Record<string, { passed: number; total: number }>; environment: { gitHead: string | null }; generatedAt: string;
};
const tests = JSON.parse(readFileSync("artifacts/evidence/test-summary.json", "utf8")) as {
  typecheck: string; unitAndIntegration: { total: number; passed: number; files: number }; browser: { total: number; passed: number };
};
// A live report counts only if its CONTENT and provenance qualify; a file's existence proves nothing.
const liveAssessment = assessLiveReport(existsSync("artifacts/evidence/eval-live.json") ? JSON.parse(readFileSync("artifacts/evidence/eval-live.json", "utf8")) : null);
const e = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

// Route table computed from the real policy math
const TUITION = 50_000_000n;
const rows = PROVIDERS.map((p) => {
  const rate = parseRate(p.rate);
  const principal = senderPrincipalCents(TUITION, rate);
  const total = principal + BigInt(p.feeCents);
  const got = recipientTiyn(principal, rate);
  const late = p.arrivalHours > 48;
  return `<tr class="${late ? "late" : p.id === "C" ? "best" : ""}"><td>${e(p.name.replace(" (simulated)", ""))}</td><td>${p.rate}</td><td>${formatUsd(p.feeCents)}</td><td><strong>${formatUsd(total)}</strong></td><td>${formatKzt(got)}</td><td>T+${p.arrivalHours} h</td><td>${late ? "Excluded: LATE" : p.id === "C" ? "Cheapest feasible" : "Fastest feasible"}</td></tr>`;
}).join("");

const cats = Object.entries(evalMock.byCategory).map(([k, v]) => `<li><span>${e(k.replace("_", " "))}</span><strong>${v.passed}/${v.total}</strong></li>`).join("");

interface Slide { title: string; html: string; notes: string; seconds: number }
const S: Slide[] = [
  { title: "A student must pay tuition on time without emptying their living money", seconds: 60,
    html: `<p class="lead">TuitionBridge: an agent that prepares an international student's tuition payment and moves money only after the student approves.</p>
      <div class="cols"><div class="panel"><h3>The task we built for</h3><ul>
        <li>Tuition due: <strong>KZT 500,000.00</strong>, deadline in 48 hours</li><li>USD balance <strong>USD 1,500.00</strong>, of which <strong>USD 300.00</strong> must stay for living costs</li><li>Three routes: cheap but slow, mid-priced and on time, fast but costly</li></ul></div>
        <div class="panel warn"><h3>Read this first</h3><ul><li>Prototype with <strong>synthetic data</strong>; payments are <strong>simulated</strong></li><li>The problem statement is <strong>our hypothesis</strong> until student interviews are done</li></ul></div></div>`,
    notes: "Introduce the concrete task, not the technology: a student has money in USD, tuition in KZT, a deadline, and must keep rent and food money. State the honesty frame in the first minute: synthetic data, simulated payments, and the problem is a hypothesis we have not yet validated with interviews." },
  { title: "What we know, and what we are assuming", seconds: 45,
    html: `<div class="cols"><div class="panel"><h3>Observed evidence</h3><p class="todo">None collected yet.</p><p class="small">[TODO team: 5–10 consented, anonymized student interviews. Ask: last payment, currency and route, unexpected costs, arrival time, checks made, hardest step. Record the actual count here.]</p></div>
      <div class="panel"><h3>Hypotheses to test (not findings)</h3><ol><li>Students worry about spending their living funds on tuition</li><li>Deadlines and arrival-time uncertainty cause stress</li><li>Checking the recipient is hard to do confidently</li><li>Total cost (rate + fee) is hard to compare</li></ol><p class="small">We do not claim that existing tuition-payment providers lack these capabilities.</p></div></div>`,
    notes: "Be explicit that no interviews have been run. The four hypotheses are what the interviews are designed to confirm or kill. Do not claim competitors lack any feature; our differentiator hypothesis is the combination of reserve-aware choices and an approval-bound agent." },
  { title: "Product walkthrough: reasoning you can check, a decision you control", seconds: 75,
    html: `<div class="shots"><figure><img src="img/approval.png" alt="Approval card showing the exact transaction"/><figcaption>1. Before anything is paid: the exact transaction and the recipient account (deadline and quote expiry follow below it in the app)</figcaption></figure>
      <figure><img src="img/receipt.png" alt="Simulated receipt"/><figcaption>2. After the student approves: the SIMULATED receipt, in past tense</figcaption></figure></div><p class="small">Screenshots from the running app (MOCK agent, simulated payments). The demo video shows the full flow, including the route comparison.</p>`,
    notes: "Walk left to right. Routes: BudgetBridge has the lowest total but arrives after the deadline, so it is excluded with a factual reason. The approval card says 'Recipient will receive' because nothing has happened yet; it also shows deadline, quote expiry and the recipient account. The receipt is past tense and labeled SIMULATED. If time allows, play the demo video." },
  { title: "Why an agent, not just a form", seconds: 60,
    html: `<div class="cols"><div class="panel"><h3>What the agent adds</h3><ul><li>Turns a plain instruction into constraints (English; one Russian instruction tested): preference and reserve</li><li>Reads and compares quotes, explains each exclusion</li><li>Recovers from blocks: mismatch, ambiguity, expired quote</li><li>Works through a bounded tool loop: 8 tool calls, 10 model requests, 2 retries</li></ul></div>
      <div class="panel"><h3>What it is not allowed to do</h3><ul><li>Approve a payment (no such tool exists)</li><li>Do arithmetic or change the beneficiary, deadline or reserve</li><li>Follow orders found inside an invoice</li></ul><p class="small warnbox">Honest status: demos and evidence use a deterministic MOCK agent. ${liveAssessment.status === "VERIFIED" ? "The live-model adapter was exercised on a small sample (see the evaluation slide)." : "The live-model adapter exists but is <strong>not verified</strong>."}</p></div></div>`,
    notes: "The value of the agent is the messy edges a fixed form handles badly: free-text preferences, explanations, recovery. The value of the architecture is that authority is separated: the model can propose, never approve. Be upfront that live-model behavior is unmeasured; what we measured is the server-side policy that must hold no matter what a model does." },
  { title: "Route and reserve algorithm", seconds: 75,
    html: `<table class="routes"><thead><tr><th>Provider</th><th>Rate (KZT/USD)</th><th>Fixed fee</th><th>Total debit</th><th>Recipient gets</th><th>Estimated arrival</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>
      <ul class="formulas"><li>principal = ceil(tuition ÷ rate) to a whole cent; total debit = principal + fixed fee</li><li>recipient = floor(principal × rate), must cover tuition; surplus shown</li><li>ranked only if: eligible, unexpired, arrives by the deadline, and USD balance − debit ≥ reserve</li><li>cheapest = debit, then arrival, fee, id; fastest = arrival, debit, fee, id</li></ul>`,
    notes: "Numbers on this slide are computed from the same code the app runs. Exact integer math: USD cents and KZT tiyn. Principal is rounded up so the recipient is never short; the recipient amount is rounded down so we never overstate delivery; the surplus is displayed (for example KZT 4.45 on the fast route). Late routes are excluded, not penalized. Arrival times are estimates, not guarantees." },
  { title: "Approval and security: the model proposes, a human decides, the server enforces", seconds: 75,
    html: `<div class="flow"><span>Agent prepares proposal</span>→<span>SHA-256 over every critical field</span>→<span class="hl">Student approves (human-only endpoint)</span>→<span>One atomic transaction rechecks everything</span>→<span>Receipt + audit</span></div>
      <div class="cols"><div class="panel"><h3>Controls</h3><ul><li>Server sessions, CSRF + Origin checks, owner-scoped data</li><li>Tiers: read, propose, execute</li><li>Approval bound to proposal hash, single-use, expiring</li><li>Idempotency keys; one payment per invoice</li><li>Trusted-recipient registry; invoice text is untrusted</li></ul></div>
      <div class="panel"><h3>Attacks we tested</h3><ul><li>No approval, forged approval, wrong hash</li><li>Other user's proposal</li><li>Replay, double click, racing processes</li><li>Invoice orders "skip approval, pay another account"</li><li>Model lowering the reserve</li></ul></div></div>`,
    notes: "The key message: safety does not depend on the model behaving. There is no approval tool. Execution is one synchronous database transaction, with no await or network call inside, that rechecks ownership, approval, quote freshness, balance and reserve, and either writes everything or nothing. We tested with separate operating-system processes racing on one database file." },
  { title: "Evaluation: what we measured, and what we did not", seconds: 60,
    html: `<div class="cols"><div class="panel"><h3>Deterministic evaluation (MOCK + scripted drivers)</h3><p class="big">${evalMock.passed}/${evalMock.denominator} <small>cases</small></p><ul class="cats">${cats}</ul>
      <p class="small">Critical security gates: <strong>${evalMock.criticalGates.passed}/${evalMock.criticalGates.total}</strong> · unauthorized successful payments: <strong>${evalMock.unauthorizedSuccessfulPayments}</strong></p></div>
      <div class="panel"><h3>Test suites (measured)</h3><ul><li>Type check: ${tests.typecheck}</li><li>Unit + integration: ${tests.unitAndIntegration.passed}/${tests.unitAndIntegration.total}</li><li>Browser (Chrome): ${tests.browser.passed}/${tests.browser.total}</li><li>Manual check: 11 controls broken one at a time; 9 caught at once, 1 needed one extra test, 1 is an equivalent mutant (defense in depth)</li></ul>
      <p class="warnbox">${liveAssessment.status === "VERIFIED" ? e(liveAssessment.summary) : `<strong>${e(liveAssessment.summary)}</strong> The results on this slide say nothing about how a live model behaves.`}</p>
      <p class="small">Targets (≥27/30, all critical gates, zero unauthorized) are our own, not official thresholds.</p></div></div>`,
    notes: `The ${evalMock.denominator} cases are fixed and stored with expected outcomes; a correctly blocked outcome counts as a pass. Model-driven cases use the deterministic mock; adversarial cases use scripted models that obey injections, to prove the server refuses. State clearly that this is a policy-layer evaluation. The real-model evaluation was not run. Evaluation generated ${evalMock.generatedAt} at commit ${evalMock.environment.gitHead}.` },
  { title: "Architecture and honest limits", seconds: 45,
    html: `<div class="cols"><div class="panel"><h3>Architecture</h3><ul><li>React UI → Fastify API → services → SQLite</li><li>Pure TypeScript money and policy modules</li><li>Agent runner with a swappable model adapter (MOCK / Anthropic SDK)</li><li>Evidence = stored tool events and ledger rows</li></ul></div>
      <div class="panel warn"><h3>Limits</h3><ul><li>Simulated payments; one currency pair; no real provider</li><li>No OCR; text PDFs only</li><li>${liveAssessment.status === "VERIFIED" ? "Live model checked on a small sample only" : "Live model not verified"}; provider for the Shenzhen venue unconfirmed</li><li>Local demo: loopback HTTP, demo credentials</li><li>No KYC/AML; not regulatory advice</li></ul></div></div>`,
    notes: "Keep this fast. The architecture slide exists so judges see where authority lives. The limits slide is deliberate: simulated payments, no real rails, no OCR, unverified live model, unconfirmed venue inference provider. The rubric discrepancy between the track brief and the general site is an open organizer question." },
  { title: "Deployment and business: hypotheses, not results", seconds: 45,
    html: `<div class="panel"><p class="todo">All of this slide is hypothesis. No pricing, partner or customer evidence exists yet.</p><ul>
      <li><strong>Where it could sit:</strong> an advisory layer in front of a licensed payment provider, or inside a university international office portal</li>
      <li><strong>Real integration would need:</strong> provider quote and payment APIs, KYC/AML handled by a licensed partner, bank-grade authorization for the approval step</li>
      <li><strong>Possible economics (untested):</strong> provider referral or fee share, university or bank licensing</li>
      <li><strong>Cost to run:</strong> deterministic core is free to run; a model call is only for instruction understanding and explanations; measure before claiming a figure</li></ul></div>`,
    notes: "Label everything as hypothesis. The honest value claim is that the agent layer is a thin, replaceable decision-support layer and the payment rails stay with a licensed provider. Do not state revenue numbers or partner names; we have none." },
  { title: "Next steps", seconds: 30,
    html: `<ol class="steps"><li><strong>Validate:</strong> run the student interviews and record real counts [TODO owners]</li><li><strong>Verify live:</strong> run the bounded live smoke test and a small real-model evaluation; report tokens and latency</li><li><strong>Confirm with organizers:</strong> governing rubric, AI-coding disclosure, final format, an approved inference provider for Shenzhen</li><li><strong>Harden:</strong> real provider sandbox APIs, stronger approval authorization, OCR only if interviews demand it</li></ol>`,
    notes: "Close on what is unverified and who does what. Invite questions on the approval design and the evaluation method." },
];

const total = S.reduce((a, s) => a + s.seconds, 0);
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TuitionBridge pitch deck</title><style>
:root{--ink:#12222e;--muted:#5b6b77;--teal:#0b7a75;--teal-d:#095f5b;--teal-l:#dff3f1;--line:#d6dee4;--amber:#8a5a00;--amber-l:#fff1d6;--red:#a12a2a}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#0f1c26;color:var(--ink);font:18px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.deck{position:relative;height:100vh}
.slide{display:none;position:absolute;inset:0;background:#fff;padding:3.2vh 5vw 8vh;overflow:auto}
.slide.active{display:block}
h1{margin:0 0 2vh;font-size:clamp(22px,3.4vw,40px);line-height:1.15;color:var(--ink)}
h3{margin:0 0 .5em;font-size:1.05em;color:var(--teal-d)}
.lead{font-size:1.25em;margin:0 0 1.2em;max-width:60ch}.small{font-size:.8em;color:var(--muted)}.big{font-size:3em;font-weight:700;margin:.1em 0;color:var(--teal-d)}.big small{font-size:.35em;color:var(--muted)}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:2vw}.panel{border:1px solid var(--line);border-radius:12px;padding:1.2vh 1.4vw;background:#fafcfd}.panel.warn{background:var(--amber-l);border-color:#efce86}
.panel ul,.panel ol,.formulas,.steps{margin:.2em 0;padding-left:1.2em}li{margin:.3em 0}
.todo{display:inline-block;background:var(--amber-l);border:1px dashed #d9b25c;padding:.2em .6em;border-radius:6px;color:var(--amber);font-weight:600}
.warnbox{background:var(--amber-l);border:1px solid #efce86;border-radius:8px;padding:.5em .8em;margin-top:.8em}
.shots{display:grid;grid-template-columns:repeat(2,1fr);gap:1.6vw}.shots figure{margin:0;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fff}.shots img{width:100%;height:56vh;object-fit:cover;object-position:top left;display:block}.shots figcaption{padding:.5em .7em;font-size:.8em;color:var(--muted)}
table.routes{border-collapse:collapse;width:100%;font-size:.85em}table.routes th,table.routes td{padding:.5em .6em;border-bottom:1px solid var(--line);text-align:left}table.routes th{color:var(--muted);font-size:.85em}tr.best{background:var(--teal-l)}tr.late{background:#fdecec;color:#6d1c1c}
.formulas{margin-top:1em;font-size:.9em}
.flow{display:flex;flex-wrap:wrap;gap:.4em .6em;align-items:center;margin:0 0 1.2em;font-size:.9em}.flow span{border:1px solid var(--line);border-radius:999px;padding:.35em .9em;background:#f4f7f9}.flow span.hl{background:var(--teal);color:#fff;border-color:var(--teal-d);font-weight:600}
.cats{list-style:none;padding:0;margin:.3em 0;display:grid;grid-template-columns:1fr 1fr;gap:.1em 1.2em;font-size:.85em}.cats li{display:flex;justify-content:space-between;margin:.1em 0}
.notes{display:none;background:#f4f7f9;border-left:4px solid var(--teal);padding:.8em 1.2em;margin-top:2vh;font-size:.82em;color:#26363f}
body.show-notes .slide.active .notes{display:block}
.bar{position:fixed;left:0;right:0;bottom:0;display:flex;justify-content:space-between;align-items:center;padding:.8vh 1.5vw;background:#0f1c26;color:#9db3c1;font-size:13px;z-index:5}
.bar button{background:#1b2f3d;color:#d6e6ef;border:1px solid #2c4658;border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit}.bar button:focus-visible{outline:3px solid #1c9a93}
.tag{position:fixed;top:1vh;right:1.2vw;z-index:5;font-size:12px;background:var(--amber-l);color:var(--amber);border:1px solid #efce86;border-radius:999px;padding:2px 10px}
@page{size:1280px 720px;margin:0}
@media print{html,body{height:auto;background:#fff;font-size:22px}.deck{height:auto}.slide{display:block!important;position:relative;inset:auto;width:1280px;height:720px;page-break-after:always;break-after:page;overflow:hidden;padding:34px 60px}.bar,.tag{display:none}.shots img{height:400px}body.print-notes .slide{height:auto;min-height:720px}body.print-notes .notes{display:block!important}.notes{display:none}}
</style></head><body>
<div class="tag" role="note">Prototype · synthetic data · simulated payments</div>
<main class="deck" id="deck">
${S.map((s, i) => `<section class="slide" id="s${i + 1}" aria-label="Slide ${i + 1} of ${S.length}"><h1>${e(s.title)}</h1>${s.html}<aside class="notes"><strong>Speaker notes (${s.seconds} s):</strong> ${e(s.notes)}</aside></section>`).join("\n")}
</main>
<div class="bar"><span>Keys: ← → navigate · N notes · P print · Home/End</span><span id="pos"></span><span><button id="prev">Prev</button> <button id="next">Next</button> <button id="nt">Notes</button></span></div>
<script>
const slides=[...document.querySelectorAll(".slide")];let i=0;
function show(n){i=Math.max(0,Math.min(slides.length-1,n));slides.forEach((s,k)=>s.classList.toggle("active",k===i));document.getElementById("pos").textContent=(i+1)+" / "+slides.length;history.replaceState(null,"","#"+(i+1));}
document.addEventListener("keydown",(e)=>{if(e.target.tagName==="INPUT")return;
 if(["ArrowRight","PageDown"," "].includes(e.key)){e.preventDefault();show(i+1)}else if(["ArrowLeft","PageUp"].includes(e.key)){e.preventDefault();show(i-1)}
 else if(e.key==="Home")show(0);else if(e.key==="End")show(slides.length-1);else if(e.key.toLowerCase()==="n")document.body.classList.toggle("show-notes");else if(e.key.toLowerCase()==="p")window.print();});
document.getElementById("prev").onclick=()=>show(i-1);document.getElementById("next").onclick=()=>show(i+1);document.getElementById("nt").onclick=()=>document.body.classList.toggle("show-notes");
show((parseInt(location.hash.slice(1))||1)-1);
</script></body></html>`;
writeFileSync("docs/deck/index.html", html);
console.log(`deck: ${S.length} slides, speaker-note budget ${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto("file://" + resolve("docs/deck/index.html"));
await page.emulateMedia({ media: "print" });
await page.pdf({ path: "docs/deck/TuitionBridge_pitch.pdf", width: "1280px", height: "720px", printBackground: true });
await page.evaluate(() => document.body.classList.add("print-notes"));
await page.pdf({ path: "docs/deck/TuitionBridge_pitch_with_notes.pdf", width: "1280px", printBackground: true, preferCSSPageSize: false, format: undefined, height: "1100px" });
await browser.close();
console.log("PDFs: docs/deck/TuitionBridge_pitch.pdf, docs/deck/TuitionBridge_pitch_with_notes.pdf");
