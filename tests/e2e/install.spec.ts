import { expect, test } from "@playwright/test";

/** A computer where RevenueOS was never configured: everything happens in the browser. */
test.use({ baseURL: `http://localhost:${process.env.E2E_INSTALL_PORT ?? 3101}` });

test("fresh installation from the browser: setup code, database, keys, migrations, admin, setup wizard", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/install/);

  // The setup code protects the installer.
  await page.getByLabel("Setup code").fill("WRNG-CODE");
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByText("Setup code is not correct")).toBeVisible();
  await page.getByLabel("Setup code").fill("e2e0-test");
  await page.getByRole("button", { name: /Continue/ }).click();

  // Database: an existing PostgreSQL server; the database itself is created by the installer.
  await expect(page.getByText("Where should RevenueOS keep its data?")).toBeVisible();
  await page.getByRole("button", { name: /My PostgreSQL/ }).click();
  const u = new URL(process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/revenueos_e2e");
  await page.getByLabel("Host").fill(u.hostname);
  await page.getByLabel("Port").fill(u.port || "5432");
  await page.getByLabel("User", { exact: true }).fill(decodeURIComponent(u.username));
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByLabel("Database", { exact: true }).fill("revenueos_e2e_install");
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(/Wrong user name or password|password authentication failed/)).toBeVisible();
  await page.getByLabel("Password").fill(decodeURIComponent(u.password));
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(/will be created/)).toBeVisible();
  await page.getByRole("button", { name: /Continue/ }).click();

  await expect(page.getByLabel("Dashboard address")).toHaveValue(/localhost:3101/);
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("button", { name: /Install RevenueOS/ }).click();
  await expect(page.getByRole("heading", { name: "Installed" })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("Encryption key generated")).toBeVisible();
  await expect(page.getByText("Database tables and security policies")).toBeVisible();

  await page.getByRole("link", { name: /Create the admin account/ }).click();
  await expect(page.getByRole("heading", { name: "Create the admin account" })).toBeVisible();
  await page.getByLabel("Name").fill("Primeira Admin");
  await page.getByLabel("E-mail").fill("admin-install@example.com");
  await page.getByLabel("Password").fill("senha-muito-forte-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/setup/);
  await expect(page.getByRole("heading", { name: "Connect Claude" })).toBeVisible();

  // Once installed, the installer is closed.
  await page.goto("/install");
  await expect(page).not.toHaveURL(/\/install/);
});
