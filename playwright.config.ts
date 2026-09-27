import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const INSTALL_PORT = Number(process.env.E2E_INSTALL_PORT ?? 3101);

/**
 * End-to-end tests drive the real dashboard (production build) against an
 * isolated database recreated on each run (see scripts/e2e-server.ts).
 * Run: pnpm test:e2e   (set E2E_BUILD=1 to rebuild the dashboard first)
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
  },
  webServer: [
    {
      command: "npx tsx scripts/e2e-server.ts",
      url: `http://localhost:${PORT}/api/health`,
      timeout: 600_000,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // Not-yet-installed instance for the browser installer test (tests/e2e/install.spec.ts).
      command: "npx tsx scripts/e2e-server.ts --fresh",
      url: `http://localhost:${INSTALL_PORT}/api/health`,
      timeout: 900_000,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
