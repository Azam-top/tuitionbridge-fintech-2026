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
  await page.getByText("Enter an offer you were given").click();
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
  test("honest labels: LIVE mode, model configured, no sandbox banner, no demo credentials", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("badge-mode")).toContainText("LIVE");
    await expect(page.getByTestId("badge-payments")).toContainText("NOT MOVED BY APP");
    await expect(page.getByTestId("badge-agent")).not.toContainText("MOCK");
    await expect(page.getByTestId("sandbox-banner")).toHaveCount(0);
    await expect(page.getByText("alice@demo.local")).toHaveCount(0);
    await expect(page.getByTestId("email")).toHaveValue("");
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

  test("with no offers the agent finds nothing and nothing is invented", async ({ page }) => {
    await register(page);
    await setup(page);
    await invoice(page);
    await expect(page.getByTestId("no-offers")).toContainText("never invents");
    await page.getByTestId("start-task").click();
    await expect(page.getByTestId("task-state")).toContainText("Blocked", { timeout: 20_000 });
    await expect(page.getByTestId("approval-card")).toHaveCount(0);
  });
});
