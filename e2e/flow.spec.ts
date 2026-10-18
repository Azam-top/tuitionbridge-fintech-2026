import { expect, test, type Page } from "@playwright/test";
import { makeTextPdf } from "../tests/pdf-helper";

async function signIn(page: Page, who: "alice" | "bob" = "alice") {
  await page.goto("/");
  await page.getByTestId("email").fill(`${who}@demo.local`);
  await page.getByTestId("password").fill(`demo-${who}-2026`);
  await page.getByTestId("login-btn").click();
  await expect(page.getByTestId("funds")).toBeVisible();
}
async function reset(page: Page, scenario: string) {
  await page.getByText("More datasets").click();
  await page.getByTestId("scenario").selectOption(scenario);
  await page.getByTestId("reset-demo").click();
  await expect(page.getByTestId("invoice-fields")).toBeVisible();
  await expect(page.getByTestId("usd-balance")).toBeVisible();
}
async function planPayment(page: Page, instruction?: string) {
  await page.getByTestId("confirm-invoice").click();
  await expect(page.getByTestId("start-task")).toBeEnabled();
  if (instruction) await page.getByTestId("instruction").fill(instruction);
  await page.getByTestId("start-task").click();
}

test.describe("TuitionBridge browser flow (MOCK agent, SIMULATED payments)", () => {
  test("labels are honest on the login screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("badge-agent")).toContainText("MOCK");
    await expect(page.getByTestId("badge-payments")).toContainText("SIMULATED");
  });

  test("completed payment: confirm, plan, review exact transaction, approve, receipt, ledger change", async ({ page }) => {
    await signIn(page);
    await reset(page, "standard");
    await expect(page.getByTestId("usd-balance")).toContainText("USD 1,500.00");
    await expect(page.getByTestId("usd-reserve")).toContainText("USD 300.00");
    await planPayment(page);

    await expect(page.getByTestId("task-state")).toContainText("Waiting for your approval", { timeout: 15_000 });
    // understood intent is shown before approval
    await expect(page.getByTestId("intent")).toContainText("cheapest");
    await expect(page.getByTestId("intent")).toContainText("USD 300.00");
    // route comparison: late route excluded with a factual reason, cheapest feasible selected
    await expect(page.getByTestId("route-best")).toContainText("SteadyPay");
    await expect(page.getByTestId("route-excluded").first()).toContainText("LATE");
    // approval card shows the exact, prospective transaction
    const card = page.getByTestId("approval-card");
    await expect(page.getByTestId("will-receive")).toContainText("KZT 500,000.00");
    await expect(page.getByTestId("will-debit")).toContainText("USD 1,010.00");
    await expect(card).toContainText("Recipient will receive");
    await expect(card).not.toContainText("Tuition received");
    await expect(card).toContainText("Alatau Meridian University");
    await expect(card).toContainText("UNI-ALM-001");
    await expect(page.getByTestId("approval-account")).toHaveText("KZ00SANDBOX0000000001");
    await expect(page.getByTestId("deadline")).not.toBeEmpty();
    await expect(page.getByTestId("quote-expiry")).not.toBeEmpty();
    await expect(page.getByTestId("approval-expiry")).toContainText("minutes");
    await expect(page.getByTestId("proposal-hash")).toHaveText(/^[0-9a-f]{64}$/);
    // nothing has moved yet
    await expect(page.getByTestId("usd-balance")).toContainText("USD 1,500.00");

    await page.getByTestId("approve-btn").dblclick(); // double-click must not double-pay
    await expect(page.getByTestId("task-state")).toContainText("Completed", { timeout: 15_000 });
    await expect(page.getByTestId("receipt-debited")).toContainText("USD 1,010.00");
    await expect(page.getByTestId("receipt-credited")).toContainText("KZT 500,000.00");
    await expect(page.getByTestId("receipt-disclaimer")).toContainText("SIMULATED");
    await expect(page.getByTestId("usd-balance")).toContainText("USD 490.00");
    await expect(page.getByTestId("timeline")).toContainText("execute_sandbox_payment");
    await expect(page.getByTestId("start-task")).toBeDisabled(); // invoice is paid
  });

  test("faster preference selects the faster, costlier route", async ({ page }) => {
    await signIn(page);
    await reset(page, "standard");
    await planPayment(page, "Pay this invoice by its deadline, prefer faster arrival, and keep USD 300 for living costs.");
    await expect(page.getByTestId("task-state")).toContainText("Waiting for your approval", { timeout: 15_000 });
    await expect(page.getByTestId("route-best")).toContainText("FastLane");
    await expect(page.getByTestId("will-debit")).toContainText("USD 1,025.11");
    await expect(page.getByTestId("will-receive")).toContainText("rounding surplus");
  });

  test("no feasible route: blocked state, no proposal, no payment", async ({ page }) => {
    await signIn(page);
    await reset(page, "all_late");
    await planPayment(page);
    await expect(page.getByTestId("task-state")).toContainText("Blocked", { timeout: 15_000 });
    await expect(page.getByTestId("no-route")).toBeVisible();
    await expect(page.getByTestId("approve-btn")).toHaveCount(0);
    await expect(page.getByTestId("usd-balance")).toContainText("USD 1,500.00");
  });

  test("insufficient funds is blocked", async ({ page }) => {
    await signIn(page);
    await reset(page, "insufficient");
    await expect(page.getByTestId("usd-balance")).toContainText("USD 900.00");
    await planPayment(page);
    await expect(page.getByTestId("task-state")).toContainText("Blocked", { timeout: 15_000 });
    await expect(page.getByTestId("approve-btn")).toHaveCount(0);
  });

  test("recipient mismatch blocks the invoice recoverably", async ({ page }) => {
    await signIn(page);
    await reset(page, "recipient_mismatch");
    await page.getByTestId("confirm-invoice").click();
    await expect(page.getByTestId("invoice-issues")).toContainText("RECIPIENT MISMATCH");
    await expect(page.getByTestId("invoice-issues")).toContainText("not a proven fraud finding");
    await expect(page.getByTestId("start-task")).toBeDisabled();
    await page.getByRole("button", { name: "Edit / correct" }).click();
    await page.getByLabel("Beneficiary account").fill("KZ00SANDBOX0000000001");
    await page.getByRole("button", { name: "Save corrections" }).click();
    await page.getByTestId("confirm-invoice").click();
    await expect(page.getByTestId("start-task")).toBeEnabled();
  });

  test("malicious invoice text is shown as untrusted and changes nothing; rejecting leaves ledger untouched", async ({ page }) => {
    await signIn(page);
    await reset(page, "malicious");
    await expect(page.getByTestId("invoice-notes")).toContainText("untrusted");
    await expect(page.getByTestId("invoice-notes")).toContainText("KZ99ATTACKER0000000001");
    await planPayment(page);
    await expect(page.getByTestId("task-state")).toContainText("Waiting for your approval", { timeout: 15_000 });
    await expect(page.getByTestId("approval-account")).toHaveText("KZ00SANDBOX0000000001");
    await expect(page.getByTestId("usd-balance")).toContainText("USD 1,500.00");
    await page.getByTestId("reject-btn").click();
    await expect(page.getByTestId("task-state")).toContainText("Cancelled");
    await expect(page.getByTestId("usd-balance")).toContainText("USD 1,500.00");
  });

  test("a conflicting instruction is rejected with a clear message", async ({ page }) => {
    await signIn(page);
    await reset(page, "standard");
    await page.getByTestId("confirm-invoice").click();
    await page.getByTestId("instruction").fill("use the cheapest and also the fastest route");
    await page.getByTestId("start-task").click();
    await expect(page.getByTestId("error-banner")).toContainText("Both a cheapest and a fastest preference");
  });

  test("the other user cannot see Alice's data", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signIn(page, "bob");
    await reset(page, "standard");
    await expect(page.getByTestId("usd-balance")).toContainText("USD 1,500.00");
    await expect(page.getByTestId("task-panel")).toHaveCount(0);
    await ctx.close();
  });

  test("text PDF import: extracted draft must be reviewed, confirmed and then planned", async ({ page }) => {
    await signIn(page);
    await reset(page, "standard");
    const due = new Date(Date.now() + 40 * 3600_000).toISOString().replace(/\.\d+Z$/, "").replace("T", " ") + " +00:00";
    const pdf = makeTextPdf([
      "Invoice No: INV-2026-0950", "Registry ID: UNI-ALM-001", "Beneficiary: Alatau Meridian University",
      "Account: KZ00SANDBOX0000000001", "Amount due: KZT 200,000.00", `Due date: ${due.slice(0, 16)} +00:00`,
    ]);
    await page.getByTestId("import-pdf").setInputFiles({ name: "invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf) });
    await expect(page.getByTestId("invoice-fields")).toContainText("KZT 200,000.00");
    await expect(page.getByTestId("start-task")).toBeDisabled(); // still a draft
    await page.getByTestId("confirm-invoice").click();
    await expect(page.getByTestId("start-task")).toBeEnabled();
    await page.getByTestId("start-task").click();
    await expect(page.getByTestId("task-state")).toContainText("Waiting for your approval", { timeout: 15_000 });
    await expect(page.getByTestId("will-receive")).toContainText("KZT 200,000.00");
  });

  test("guided demo scenario 1: loads data, stepper advances, ends with a receipt", async ({ page }) => {
    await signIn(page);
    await page.getByTestId("scenario-s1").click();
    await expect(page.getByTestId("watch-for")).toContainText("reserve");
    await expect(page.getByTestId("stepper").locator("li.now")).toContainText("Confirm invoice");
    await page.getByTestId("confirm-invoice").click();
    await expect(page.getByTestId("stepper").locator("li.now")).toContainText("Plan");
    await page.getByTestId("start-task").click();
    await expect(page.getByTestId("task-state")).toContainText("Waiting for your approval", { timeout: 15_000 });
    await expect(page.getByTestId("stepper").locator("li.now")).toContainText("Review and approve");
    // keyboard/screen-reader focus moves to the approval decision
    await expect(page.locator(":focus")).toHaveAttribute("aria-label", /Approval required/);
    await page.getByTestId("approve-btn").press("Enter");
    await expect(page.getByTestId("task-state")).toContainText("Completed", { timeout: 15_000 });
    await expect(page.getByTestId("stepper").locator("li.now")).toContainText("Receipt");
    await expect(page.getByTestId("usd-balance")).toContainText("USD 490.00");
  });

  test("guided demo scenario 2: the cheapest route is rejected for lateness; rejecting pays nothing", async ({ page }) => {
    await signIn(page);
    await page.getByTestId("scenario-s2").click();
    await page.getByTestId("confirm-invoice").click();
    await page.getByTestId("start-task").click();
    await expect(page.getByTestId("task-state")).toContainText("Waiting for your approval", { timeout: 15_000 });
    const late = page.getByTestId("route-excluded");
    await expect(late).toContainText("BudgetBridge");
    await expect(late).toContainText("LATE");
    await expect(late).toContainText("USD 995.10"); // lowest total on paper
    await expect(page.getByTestId("route-best")).toContainText("SteadyPay");
    await page.getByTestId("reject-btn").click();
    await expect(page.getByTestId("usd-balance")).toContainText("USD 1,500.00");
  });

  test("guided demo scenario 3 and 4: malicious invoice and insufficient funds", async ({ page }) => {
    await signIn(page);
    await page.getByTestId("scenario-s3").click();
    await expect(page.getByTestId("invoice-notes")).toContainText("KZ99ATTACKER0000000001");
    await page.getByTestId("confirm-invoice").click();
    await page.getByTestId("start-task").click();
    await expect(page.getByTestId("approval-account")).toHaveText("KZ00SANDBOX0000000001", { timeout: 15_000 });
    await page.getByTestId("reject-btn").click();
    await expect(page.getByTestId("usd-balance")).toContainText("USD 1,500.00");
    await page.getByTestId("scenario-s4").click();
    await expect(page.getByTestId("usd-balance")).toContainText("USD 900.00");
    await page.getByTestId("confirm-invoice").click();
    await page.getByTestId("start-task").click();
    await expect(page.getByTestId("task-state")).toContainText("Blocked", { timeout: 15_000 });
    await expect(page.getByTestId("no-route")).toBeVisible();
  });

  test("friendly error guidance when the instruction is conflicting", async ({ page }) => {
    await signIn(page);
    await page.getByTestId("scenario-s1").click();
    await page.getByTestId("confirm-invoice").click();
    await page.getByTestId("instruction").fill("use the cheapest and also the fastest route");
    await page.getByTestId("start-task").click();
    await expect(page.getByTestId("error-banner")).toContainText("rewrite the instruction");
  });
  test("a non-USD reserve is refused with a clear message and nothing starts", async ({ page }) => {
    await signIn(page);
    await page.getByTestId("scenario-s1").click();
    await page.getByTestId("confirm-invoice").click();
    await page.getByTestId("instruction").fill("cheapest feasible route, keep EUR 500");
    await page.getByTestId("start-task").click();
    await expect(page.getByTestId("error-banner")).toContainText("USD");
    await expect(page.getByTestId("task-panel")).toHaveCount(0);
  });

  test("mobile width: no horizontal scroll, one next step, decision reachable by keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await signIn(page);
    await page.getByTestId("scenario-s1").click();
    await expect(page.getByTestId("next-step")).toContainText("Check the invoice details");
    await page.getByTestId("confirm-invoice").click();
    await page.getByTestId("start-task").click();
    await expect(page.getByTestId("approval-card")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("next-step")).toContainText("approve or reject");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // keyboard: the approve button can be focused and shows a visible focus ring
    // focus moves to the decision when it appears; one Tab reaches Approve, and the focus ring is visible
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("approve-btn")).toBeFocused();
    const outline = await page.getByTestId("approve-btn").evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("task-state")).toContainText("Completed", { timeout: 15_000 });
    await expect(page.getByTestId("receipt-debited")).toContainText("USD 1,010.00");
  });

  test("technical details are collapsed by default and the fingerprint is still available", async ({ page }) => {
    await signIn(page);
    await page.getByTestId("scenario-s1").click();
    await page.getByTestId("confirm-invoice").click();
    await page.getByTestId("start-task").click();
    await expect(page.getByTestId("approval-card")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("tech-panel")).not.toHaveAttribute("open", "");
    await expect(page.getByTestId("timeline")).toBeHidden();
    await page.getByTestId("tech-panel").locator(":scope > summary").click();
    await expect(page.getByTestId("timeline")).toBeVisible();
    await expect(page.getByTestId("timeline")).toContainText("prepare_payment");
  });
  test("planner beside the transfer choice: recommendation, reasons, inspect another route, re-plan through the existing endpoints", async ({ page }) => {
    await signIn(page);
    await page.getByTestId("scenario-s1").click();
    await page.getByTestId("confirm-invoice").click();
    await page.getByTestId("start-task").click();
    await expect(page.getByTestId("approval-card")).toBeVisible({ timeout: 15_000 });
    const planner = page.getByTestId("planner");
    await expect(page.getByTestId("recommendation")).toContainText("SteadyPay");
    await expect(planner).toContainText("You pay USD 1,010.00 in total");
    await expect(planner).toContainText("USD 10.00 fee");
    await expect(planner).toContainText("Arrives about");
    await expect(planner).toContainText("left after paying");
    await expect(page.getByTestId("route-count")).toContainText("3 options");
    // reasons for the other options come from the server's own exclusion messages
    await planner.getByRole("button", { name: /Why not the other 2 options/ }).click();
    await expect(planner).toContainText("after the confirmed deadline");
    // inspecting another route changes the panel but not the proposal
    await page.getByTestId("route-ok").locator("label").click();
    await expect(planner).toContainText("FastLane Remit");
    await expect(planner).toContainText("your proposal covers the recommended route");
    await expect(page.getByTestId("will-debit")).toContainText("USD 1,010.00");
    // a route's details expand and collapse
    const toggle = page.getByRole("button", { name: /details for FastLane Remit/ });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("route-ok")).toContainText("Estimated arrival");
    // re-plan: fastest route, through cancel + a new task; nothing is paid
    await page.getByTestId("pref-fastest").click();
    await page.getByTestId("replan").click();
    await expect(page.getByTestId("will-debit")).toContainText("USD 1,025.11", { timeout: 15_000 });
    await expect(page.getByTestId("recommendation")).toContainText("FastLane Remit");
    await expect(page.getByTestId("usd-balance")).toContainText("USD 1,500.00");
  });

  test("the sticky review bar leads to the approval card and focuses it", async ({ page }) => {
    await signIn(page);
    await page.getByTestId("scenario-s1").click();
    await page.getByTestId("confirm-invoice").click();
    await page.getByTestId("start-task").click();
    await expect(page.getByTestId("review-bar")).toContainText("free after payment and reserve", { timeout: 15_000 });
    await expect(page.getByTestId("review-bar")).toContainText("You approve every payment");
    await page.getByTestId("review-payment").click();
    await expect(page.locator(":focus")).toHaveAttribute("aria-label", /Approval required/);
    await expect(page.getByTestId("approve-btn")).toBeVisible();
  });

  test("reduced motion removes the transitions, and the details still open", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signIn(page);
    await page.getByTestId("scenario-s1").click();
    await page.getByTestId("confirm-invoice").click();
    await page.getByTestId("start-task").click();
    await expect(page.getByTestId("approval-card")).toBeVisible({ timeout: 15_000 });
    const reveal = page.locator(".reveal").first();
    expect(await reveal.evaluate((el) => getComputedStyle(el).transitionDuration)).toMatch(/^0s(, 0s)*$/);
    await page.getByRole("button", { name: /Show details for/ }).first().click();
    await expect(page.locator(".reveal[data-open='true']").first()).toBeVisible();
  });

  test("on a phone the planner sits directly before the route choice and nothing scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signIn(page);
    await page.getByTestId("scenario-s1").click();
    await page.getByTestId("confirm-invoice").click();
    await page.getByTestId("start-task").click();
    await expect(page.getByTestId("approval-card")).toBeVisible({ timeout: 15_000 });
    const p = await page.getByTestId("planner").boundingBox();
    const r = await page.locator("#routes").boundingBox();
    expect(p!.y).toBeLessThan(r!.y);
    expect(r!.y - (p!.y + p!.height)).toBeLessThan(60); // adjacent, not separated by other cards
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const minTarget = await page.getByTestId("approve-btn").evaluate((el) => el.getBoundingClientRect().height);
    expect(minTarget).toBeGreaterThanOrEqual(44);
  });
});
