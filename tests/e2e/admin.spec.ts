import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("first account becomes admin, creates a LIVE business and sees what to connect", async ({ page }) => {
  // Protected pages redirect to login.
  await page.goto("/overview");
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/signup");
  await page.getByLabel("Name").fill("Dona do Negócio");
  await page.getByLabel("E-mail").fill(`owner-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("uma-senha-bem-forte");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/(setup|onboarding)/);
  await page.goto("/setup");
  await expect(page.getByRole("heading", { name: "Setup checklist" })).toBeVisible();

  // Onboarding wizard (10 steps)
  await page.goto("/onboarding");
  await page.getByPlaceholder("e.g. Clínica Sorriso").fill("Clínica Sorriso E2E");
  await page.getByPlaceholder("e.g. odontologia").fill("odontologia");
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("button", { name: /Skip/ }).click();
  await page.getByRole("textbox").first().fill("Adultos de 25 a 50 anos que querem clarear os dentes");
  await page.getByRole("button", { name: /Continue/ }).click(); // → Offer
  await page.getByRole("button", { name: /Continue/ }).click(); // → Products
  await page.getByPlaceholder("Product or service").fill("Clareamento");
  await page.getByPlaceholder("Price (R$)").fill("890");
  await page.getByRole("button", { name: /Continue/ }).click(); // → Brand
  await page.getByRole("button", { name: /Continue/ }).click(); // → Channels
  await page.getByRole("button", { name: /Continue/ }).click(); // → Sales & mode
  await page.getByRole("button", { name: /Continue/ }).click(); // → Review
  await expect(page.getByText("Clareamento (R$ 890)")).toBeVisible();
  await page.getByRole("button", { name: /Continue/ }).click(); // → Launch
  await page.getByRole("button", { name: "Create business" }).click();
  await page.waitForURL(/\/w\/[^/]+\/connections/);

  // Nothing is published until accounts are connected; the app says exactly what is missing.
  await expect(page.getByText("LIVE", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/developer app is not configured yet/).first()).toBeVisible();

  // Admin-only settings are available to the first account.
  await page.goto("/settings?tab=ai");
  await expect(page.getByRole("main")).toContainText(/Claude|Anthropic/);
});

test("wrong password is rejected with a clear message", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("nobody@example.com");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("E-mail or password is incorrect.")).toBeVisible();
});
