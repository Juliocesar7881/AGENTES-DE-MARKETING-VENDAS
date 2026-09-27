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
  await page.waitForURL(/\/setup/);

  // Setup wizard: starts at the first open step, with the real forms inline.
  await expect(page.getByRole("heading", { name: "Connect Claude" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save & test" })).toBeDisabled();
  await page.getByRole("button", { name: /Economy/ }).click();
  await expect(page.getByText("Economy preset selected")).toBeVisible();
  await expect(page.getByRole("button", { name: /Economy/ })).toHaveAttribute("aria-pressed", "true");

  // Business step → onboarding wizard (10 steps) → back to the setup wizard.
  await page.getByRole("link", { name: /3\. Your business/ }).click();
  await page.getByRole("main").getByRole("link", { name: /Create your first business/ }).click();
  await page.waitForURL(/\/onboarding\?from=setup/);
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
  await page.waitForURL(/\/setup\?step=apps&ws=/);
  await expect(page.getByText("LIVE", { exact: true }).first()).toBeVisible();

  // Developer apps: guide + redirect URI + credentials, saved encrypted.
  await expect(page.getByRole("heading", { name: "Developer apps" })).toBeVisible();
  const ig = page.locator("form").filter({ hasText: "Instagram app ID" });
  await expect(ig.getByText("/api/oauth/instagram/callback")).toBeVisible();
  await ig.getByLabel("Instagram app ID").fill("123456789012345");
  await ig.getByLabel("Instagram app secret").fill("e2e-app-secret-value");
  await ig.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Ready").first()).toBeVisible();

  // Social accounts: Instagram can now be connected with official OAuth; TikTok still needs its app.
  await page.getByRole("link", { name: /Next: Social accounts/ }).click();
  await expect(page.getByRole("link", { name: "Connect Instagram" })).toHaveAttribute("href", /\/api\/oauth\/instagram\/start\?workspaceId=/);
  await expect(page.getByText(/developer app is not configured yet/).first()).toBeVisible();

  // Go live: choose the mode and run every connection test for real.
  await page.getByRole("link", { name: /9\. Go live/ }).click();
  await page.getByRole("button", { name: /Autopilot/ }).click();
  await expect(page.getByText(/: Autopilot/)).toBeVisible();
  await page.getByRole("button", { name: "Run all tests" }).click();
  await expect(page.getByText("Local worker", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("No account connected")).toBeVisible();

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
