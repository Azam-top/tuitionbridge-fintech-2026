// LIVE mode in the browser. The model is a LOCAL FAKE provider (e2e/fake-provider.ts); Wise and NBK are switched off so no
// test touches the network. This verifies the app's own behaviour, not any real model or provider.
import { expect, test, type Page } from "@playwright/test";

function makeIban(bban = "125KZT0000000001", cc = "KZ"): string {
  const digits = (bban + cc + "00").split("").map((c) => (c >= "A" ? String(c.charCodeAt(0) - 55) : c)).join("");
  let rem = 0;
  for (const ch of digits) rem = (rem * 10 + Number(ch)) % 97;
  return `${cc}${String(98 - rem).padStart(2, "0")}${bban}`;
}
const IBAN = makeIban();
const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const days = (n: number) => new Date(Date.now() + n * 86_400_000);
let seq = 0;
const email = () => `student${Date.now()}${seq++}@example.org`;

async function register(page: Page) {
  await page.goto("/");
  await page.getByTestId("toggle-register").click();
  await page.getByTestId("email").fill(email());
  await page.getByTestId("display-name").fill("Test Student");
  await page.getByTestId("password").fill("a-long-test-password");
  await page.getByTestId("login-btn").click();
  await expect(page.getByTestId("funds")).toBeVisible();
}
async function setup(page: Page) {
  await page.getByTestId("funds-balance-input").fill("1500");
  await page.getByTestId("funds-reserve-input").fill("300");
  await page.getByTestId("funds-save").click();
  await expect(page.getByTestId("usd-balance")).toContainText("USD 1,500.00");
  await page.getByTestId("recipient-name").fill("Test University");
  await page.getByTestId("recipient-account").fill(IBAN);
  await page.getByTestId("recipient-url").fill("https://example.edu/payments");
  await page.getByTestId("recipient-note").fill("Official payment page, copied today");
  await page.getByTestId("recipient-add").click();
  await expect(page.getByTestId("recipient-list")).toContainText("Test University");
}
async function invoice(page: Page) {
  await page.getByTestId("invoice-ref").fill("INV-E2E-1");
  await page.getByTestId("invoice-recipient").selectOption({ index: 1 });
  await page.getByTestId("invoice-amount").fill("500000");
  await page.getByTestId("invoice-due").fill(local(days(7)));
  await page.getByTestId("invoice-create").click();
  await page.getByTestId("confirm-invoice").click();
  await expect(page.getByTestId("offers-card")).toBeVisible();
}
async function addOffer(page: Page) {
  await page.getByTestId("manual-offer").locator("summary").click();
  await page.getByTestId("offer-provider").fill("Test Bank");
  await page.getByTestId("offer-rate").fill("450");
  await page.getByTestId("offer-fee").fill("12");
  await page.getByTestId("offer-arrival").fill(local(days(2)));
  await page.getByTestId("offer-valid").fill(local(new Date(Date.now() + 3 * 3600_000)));
  await page.getByTestId("offer-seen").fill(local(new Date(Date.now() - 5 * 60_000)));
  await page.getByTestId("offer-note").fill("Bank app quote screen");
  await page.getByTestId("offer-add").click();
  await expect(page.getByTestId("offer-list")).toContainText("Entered by you");
}

test.describe("TuitionBridge LIVE mode (fake local model provider; Wise and NBK off)", () => {
  test("an ordinary screen: no mode badges, no model name, no token counters; technical details are one click away", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("badge-mode")).toHaveCount(0); // not on the sign-in screen either
    await expect(page.getByTestId("sandbox-banner")).toHaveCount(0);
    await expect(page.getByText("alice@demo.local")).toHaveCount(0);
    await expect(page.getByTestId("email")).toHaveValue("");
    await register(page);
    await expect(page.getByTestId("badge-mode")).toBeHidden();
    await expect(page.getByTestId("badge-agent")).toBeHidden();
    await expect(page.getByTestId("planner")).not.toContainText("fake-model");
    await expect(page.getByTestId("planner")).not.toContainText(/LIVE|MOCK|token/);
    await page.getByTestId("tech-details").locator("summary").click();
    await expect(page.getByTestId("badge-mode")).toContainText("LIVE");
    await expect(page.getByTestId("badge-payments")).toContainText("NOT MOVED BY APP");
    await expect(page.getByTestId("badge-agent")).not.toContainText("MOCK");
    await expect(page.getByTestId("tech-details")).toContainText("fake-model");
  });

  test("full live flow: register, declare funds, attest recipient, invoice, offer, plan, approve, instruction, evidence", async ({ page }) => {
    await register(page);
    await expect(page.getByTestId("next-step")).toContainText("Set up your funds");
    await setup(page);
    await invoice(page);
    await expect(page.getByTestId("offers-message")).toHaveCount(0);
    await addOffer(page);
    await page.getByTestId("start-task").click();
    await expect(page.getByTestId("task-state")).toContainText("Waiting for your approval", { timeout: 20_000 });
    await expect(page.getByTestId("offer-source")).toContainText("Entered by you");
    await expect(page.getByTestId("offer-source")).toContainText("Bank app quote screen");
    await expect(page.getByTestId("will-debit")).toContainText("USD 1,123.12");
    await expect(page.getByTestId("approve-btn")).toContainText("issue payment instruction");
    await expect(page.getByTestId("agent-summary")).not.toContainText(/completed|executed|payment made/i);
    await expect(page.getByTestId("agent-summary")).toContainText("Nothing has been paid yet");
    await page.getByTestId("approve-btn").dblclick();
    await expect(page.getByTestId("task-state")).toContainText("Approved: instruction issued", { timeout: 20_000 });
    // no simulated receipt and no ledger movement in the live mode
    await expect(page.getByTestId("receipt")).toHaveCount(0);
    await expect(page.getByTestId("usd-balance")).toContainText("USD 1,500.00");
    await expect(page.getByTestId("instruction-card")).toBeVisible();
    await expect(page.getByTestId("instruction-status")).toContainText("has not moved any money");
    await expect(page.getByTestId("instruction-account")).toHaveText(IBAN);
    await expect(page.getByTestId("instruction-total")).toContainText("USD 1,123.12");
    await expect(page.getByTestId("start-task")).toBeDisabled(); // the invoice is locked
    // the user's own statement and an uploaded file are stored but never called verification
    await page.getByTestId("mark-paid").click();
    await expect(page.getByTestId("instruction-status")).toContainText("not verified by a bank");
    await page.getByTestId("upload-confirmation").setInputFiles({ name: "confirmation.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% e2e confirmation\n%%EOF\n") });
    await expect(page.getByTestId("instruction-status")).toContainText("stored, not verified");
    await expect(page.getByTestId("evidence-list")).toContainText("did not verify");
    await expect(page.getByTestId("evidence-list")).not.toContainText(/confirmed by (the )?bank|bank[- ]confirmed/i);
  });

  test("a wrong IBAN checksum is refused and a non-https source is refused", async ({ page }) => {
    await register(page);
    await page.getByTestId("recipient-name").fill("Typo University");
    await page.getByTestId("recipient-account").fill(IBAN.slice(0, -1) + (IBAN.endsWith("0") ? "1" : "0"));
    await page.getByTestId("recipient-url").fill("https://example.edu/payments");
    await page.getByTestId("recipient-note").fill("copied");
    await page.getByTestId("recipient-add").click();
    await expect(page.getByTestId("error-banner")).toContainText("checksum");
    await page.getByTestId("recipient-account").fill(IBAN);
    await page.getByTestId("recipient-url").fill("http://example.edu/payments");
    await page.getByTestId("recipient-add").click();
    await expect(page.getByTestId("error-banner")).toContainText("https");
  });

  test("an invoice for an unattested account is blocked, and the app invents no offers", async ({ page }) => {
    await register(page);
    await setup(page);
    await page.getByTestId("invoice-ref").fill("INV-UNKNOWN");
    await page.getByTestId("invoice-recipient").selectOption({ index: 1 });
    await page.getByTestId("invoice-amount").fill("100000");
    await page.getByTestId("invoice-due").fill(local(days(5)));
    await page.getByTestId("invoice-create").click();
    await expect(page.getByTestId("invoice-fields")).toBeVisible();
    // edit the account to one nobody attested, then confirm -> blocked with the live explanation
    await page.getByRole("button", { name: "Edit / correct" }).click();
    await page.getByLabel("Beneficiary account").fill(makeIban("999KZT0000000009"));
    await page.getByRole("button", { name: "Save corrections" }).click();
    await page.getByTestId("confirm-invoice").click();
    await expect(page.getByTestId("invoice-issues")).toContainText("attested");
    await expect(page.getByTestId("offers-card")).toHaveCount(0);
  });

  test("with no offers the planner says so, cannot start, and nothing is invented", async ({ page }) => {
    await register(page);
    await setup(page);
    await invoice(page);
    await expect(page.getByTestId("no-offers")).toContainText("never invents");
    await expect(page.getByTestId("planner-no-offers")).toContainText("no payment options yet");
    await expect(page.getByTestId("start-task")).toBeDisabled();
    await expect(page.getByTestId("approval-card")).toHaveCount(0);
  });
});

test.describe("LIVE mode, the ordinary user path (fake local model; Wise and NBK off)", () => {
  async function ready(page: Page) {
    await register(page);
    await setup(page);
    await invoice(page);
    await addOffer(page);
  }

  test("one effective reserve everywhere: it is clear before planning and identical in every card afterwards", async ({ page }) => {
    await ready(page);
    // before planning: the applied reserve is stated next to the button and in the funds strip
    await expect(page.getByTestId("reserve-applied")).toContainText("USD 300.00");
    await expect(page.getByTestId("usd-reserve")).toContainText("USD 300.00");
    await page.getByTestId("reserve-input").fill("200");
    await expect(page.getByTestId("reserve-applied")).toContainText("USD 200.00");
    await expect(page.getByTestId("usd-reserve")).toContainText("USD 200.00");
    await expect(page.getByTestId("funds")).toContainText("Saved default: USD 300.00");
    await expect(page.getByTestId("usd-available")).toContainText("USD 1,300.00");
    await page.getByTestId("start-task").click();
    await expect(page.getByTestId("task-state")).toContainText("Waiting for your approval", { timeout: 20_000 });
    // after planning: the server's own reserve for this plan, repeated in the intent, the budget bar and the funds strip
    await expect(page.getByTestId("intent")).toContainText("USD 200.00");
    await expect(page.getByTestId("budget-card")).toContainText("USD 200.00");
    await expect(page.getByTestId("usd-reserve")).toContainText("USD 200.00");
    await expect(page.getByTestId("budget-card")).not.toContainText("USD 300.00");
    await expect(page.getByTestId("planner")).not.toContainText("USD 1.00");
  });

  test("the planner shows the assistant's explanation, and the model name and token counters stay in the technical details", async ({ page }) => {
    await ready(page);
    await page.getByTestId("start-task").click();
    await expect(page.getByTestId("task-state")).toContainText("Waiting for your approval", { timeout: 20_000 });
    await expect(page.getByTestId("recommendation")).toBeVisible();
    await expect(page.getByTestId("assistant-explanation")).toContainText("Explained by the AI assistant");
    await expect(page.getByTestId("assistant-explanation")).toContainText("The proposal is ready for your review");
    await expect(page.getByTestId("assistant-explanation")).toContainText("The server, not the assistant, ranked the routes");
    await expect(page.getByTestId("usage")).toBeHidden(); // tokens, requests and latency are collapsed
    await expect(page.getByTestId("task-panel")).not.toContainText("MOCK");
    await page.getByTestId("tech-panel").locator(":scope > summary").click();
    await expect(page.getByTestId("usage")).toContainText("tokens");
  });

  test("a model outage is explained, nothing is invented or paid, and Try again recovers", async ({ page }) => {
    await ready(page);
    await page.locator("details.own-words").evaluate((el) => { (el as HTMLDetailsElement).open = true; });
    await page.getByTestId("instruction").fill("Pay this invoice by its deadline, use the cheapest feasible route, and keep USD 300 for living costs. FAKE_PROVIDER_OUTAGE");
    await page.getByTestId("start-task").click();
    await expect(page.getByTestId("problem")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("problem")).toContainText("The AI assistant could not finish");
    await expect(page.getByTestId("task-error")).toContainText("HTTP 500");
    await expect(page.getByTestId("problem")).toContainText("Nothing was paid");
    await expect(page.getByTestId("task-state")).toContainText("Failed");
    // no stand-in result and no proposal appeared
    await expect(page.getByTestId("approval-card")).toHaveCount(0);
    await expect(page.getByTestId("recommendation")).toHaveCount(0);
    await expect(page.getByTestId("task-panel")).not.toContainText("MOCK");
    // fix the cause (here: the marker that makes the fake provider fail) and retry from the same screen
    await page.getByTestId("instruction").fill("Pay this invoice by its deadline, use the cheapest feasible route, and keep USD 300 for living costs.");
    await page.getByTestId("retry-plan").click();
    await expect(page.getByTestId("task-state")).toContainText("Waiting for your approval", { timeout: 30_000 });
    await expect(page.getByTestId("problem")).toHaveCount(0);
  });

  test("after approval the Wise button opens one fixed address (shown only for a Wise offer)", async ({ page }) => {
    await ready(page);
    await page.getByTestId("start-task").click();
    await expect(page.getByTestId("task-state")).toContainText("Waiting for your approval", { timeout: 20_000 });
    await page.getByTestId("approve-btn").click();
    await expect(page.getByTestId("instruction-card")).toBeVisible({ timeout: 20_000 });
    // the offer here was typed by the user, so there is no Wise hand-off
    await expect(page.getByTestId("wise-handoff")).toHaveCount(0);
    // rendering check with a stored Wise provider offer: only the provenance and name of the stored instruction are altered in transit
    await page.route("**/api/tasks/*", async (route) => {
      const res = await route.fetch();
      const json = await res.json();
      if (json.instruction) { json.instruction.body.source.provenance = "PROVIDER_LIVE"; json.instruction.body.provider = "Wise (pay by bank transfer)"; json.instruction.body.steps = ["Open https://evil.example/pay now"]; }
      await route.fulfill({ response: res, json });
    });
    await page.reload();
    const go = page.getByTestId("go-to-wise");
    await expect(go).toBeVisible();
    await expect(go).toHaveAttribute("href", "https://wise.com/");
    await expect(go).toHaveAttribute("target", "_blank");
    await expect(go).toHaveAttribute("rel", /noopener/);
    await expect(page.getByTestId("wise-handoff")).toContainText("Finish the payment on Wise");
    // no other link on the card is taken from the instruction text
    await expect(page.getByTestId("instruction-card").locator("a")).toHaveCount(1);
  });
});
