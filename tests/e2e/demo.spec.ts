import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const BUSINESSES = ["Pequenos Passos", "Auto Prime", "OdontoFlow"];
const BASE_URL = `http://localhost:${process.env.E2E_PORT ?? 3100}`;
const newContext = (browser: Browser) => browser.newContext({ baseURL: BASE_URL, locale: "pt-BR", timezoneId: "America/Sao_Paulo", viewport: { width: 1440, height: 900 } });

async function openDemo(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Explore Demo" }).click();
  await page.waitForURL("**/overview", { timeout: 180_000 });
}

async function openBusiness(page: Page, name: string): Promise<string> {
  await page.getByRole("navigation").getByRole("link", { name, exact: false }).first().click();
  await page.waitForURL(/\/w\/[^/]+$/);
  return new URL(page.url()).pathname.split("/")[2]!;
}

test.describe.configure({ mode: "serial" });

test.describe("Explore Demo — the whole revenue cycle in the browser", () => {
  let ctx: BrowserContext;
  let page: Page;
  let slug: string;

  test.beforeAll(async ({ browser }) => {
    ctx = await newContext(browser);
    page = await ctx.newPage();
    page.on("dialog", (d) => void d.accept());
  });
  test.afterAll(async () => {
    await ctx.close();
  });

  test("opens the dashboard with 3 isolated DEMO businesses", async () => {
    await openDemo(page);
    await expect(page.getByText("DEMO", { exact: true }).first()).toBeVisible();
    for (const name of BUSINESSES) await expect(page.getByRole("main").getByText(name).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "All businesses" })).toBeVisible();
  });

  test("content studio shows generated videos with a working player", async () => {
    slug = await openBusiness(page, "Pequenos Passos");
    await page.goto(`/w/${slug}/content`);
    const first = page.locator(`a[href^="/w/${slug}/content/"]`).first();
    await expect(first).toBeVisible();
    await first.click();
    await page.waitForURL(new RegExp(`/w/${slug}/content/[0-9a-f-]{36}`));
    await expect(page.getByRole("button", { name: /Live preview/ })).toBeVisible();
    await page.getByRole("button", { name: /Live preview/ }).click();
    await expect(page.getByText("Live preview renders the VideoSpec in your browser")).toBeVisible();
  });

  test("inbox: take over a conversation from the Sales Agent and hand it back", async () => {
    await page.goto(`/w/${slug}/inbox`);
    const conv = page.locator(`a[href^="/w/${slug}/inbox?"][href*="c="]`).first();
    await expect(conv).toBeVisible();
    await conv.click();
    const takeOver = page.getByRole("button", { name: "Take over" }).first();
    const returnToAi = page.getByRole("button", { name: "Return to AI" });
    if (await returnToAi.isVisible().catch(() => false)) {
      await returnToAi.click();
      await expect(page.getByText("Sales Agent active")).toBeVisible();
    }
    await takeOver.click();
    await expect(page.getByText("You are handling")).toBeVisible();
    await page.getByPlaceholder("Write a reply…").fill("Olá! Aqui é a equipe, vou te atender pessoalmente.");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Olá! Aqui é a equipe, vou te atender pessoalmente.")).toBeVisible();
    await page.getByRole("button", { name: "Return to AI" }).click();
    await expect(page.getByText("Sales Agent active")).toBeVisible();
  });

  test("public lead form → CRM → checkout link → payment webhook → attributed sale", async ({ browser }) => {
    const visitor = `Visitante E2E ${Date.now().toString().slice(-5)}`;
    // The visitor is an anonymous browser (no dashboard session).
    const visitorCtx = await newContext(browser);
    const pub = await visitorCtx.newPage();
    await pub.goto(`/l/${slug}`);
    await pub.getByPlaceholder("Seu nome").fill(visitor);
    await pub.getByPlaceholder("WhatsApp com DDD").fill("11 98765-4321");
    await pub.getByPlaceholder("Como podemos ajudar? (opcional)").fill("Quero saber o preço");
    await pub.locator('input[name="consent"]').check();
    await pub.getByRole("button", { name: "Quero falar com vocês" }).click();
    await expect(pub.getByText("Recebemos seu contato!")).toBeVisible();

    await page.goto(`/w/${slug}/crm`);
    await page.getByText(visitor).first().click();
    await page.waitForURL(new RegExp(`/w/${slug}/crm/[0-9a-f-]{36}`));
    await page.getByRole("button", { name: "Checkout link" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Create link" }).click();
    const linkInput = dialog.locator("input[readonly]");
    await expect(linkInput).toHaveValue(/\/demo\/checkout\//);
    const url = new URL(await linkInput.inputValue());
    await page.keyboard.press("Escape");

    await pub.goto(url.pathname);
    await pub.getByRole("button", { name: "Pay with Pix (simulated)" }).click();
    await expect(pub.getByText("Payment approved (demo)")).toBeVisible();
    await visitorCtx.close();

    await page.goto(`/w/${slug}/sales`);
    await expect(page.getByRole("main").getByText(visitor).first()).toBeVisible();
    await page.goto(`/w/${slug}/crm`);
    await page.getByText(visitor).first().click();
    await expect(page.getByText(/won/i).first()).toBeVisible();
  });

  test("Simulate Day runs the pipeline on the demo businesses", async () => {
    await page.goto("/overview");
    await page.getByRole("button", { name: "Simulate Day" }).click();
    await expect(page.getByText(/Day simulated: \d+ posts, \d+ leads/)).toBeVisible({ timeout: 240_000 });
  });

  test("Stop all pauses the demo businesses and Resume restores them", async () => {
    await page.goto("/overview");
    await page.getByRole("button", { name: /Stop all/ }).click();
    await expect(page.getByText("Demo businesses stopped")).toBeVisible();
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page.getByText("Demo businesses stopped")).toBeHidden();
  });

  test("another tenant's workspace URL is a 404", async () => {
    const res = await page.goto("/w/not-my-business");
    expect(res?.status()).toBe(404);
  });
});
