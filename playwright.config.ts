import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
/** The journeys a reader cannot do without: importing, reading, selecting, marking, coming back. Run on every engine, not only Chromium. */
const CRITICAL = /(ingest-and-marks|reader|annotations|position|import-and-isolation|ai-limits)\.spec\.ts/;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    // The browser suites import dozens of texts from one address; the import limiter is covered by its own tests.
    env: { GLOSS_RATE_IMPORT: "off" },
    timeout: 120_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 1440, height: 900 } }, testMatch: CRITICAL },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } }, testMatch: CRITICAL },
    { name: "mobile-safari", use: { ...devices["iPhone 14"] }, testMatch: /mobile\.spec\.ts/ },
    // Pixel comparisons against baselines made on this machine; run on request (`pnpm test:visual`), not with the functional suite.
    { name: "visual", testDir: "./tests/visual", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
});
