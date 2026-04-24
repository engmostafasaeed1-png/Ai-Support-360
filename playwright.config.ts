import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config.
 *
 * In CI (Lovable agent), `lovable-agent-playwright-config` is installed and
 * provides the canonical project config. Locally that package may not be
 * present, so we fall back to a minimal config that still runs e2e tests.
 */
let config: ReturnType<typeof defineConfig>;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createLovableConfig } = require("lovable-agent-playwright-config/config");
  config = createLovableConfig({
    testDir: "./e2e",
  });
} catch {
  config = defineConfig({
    testDir: "./e2e",
    timeout: 30_000,
    expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
    use: {
      baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
      trace: "retain-on-failure",
    },
    projects: [
      { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    ],
  });
}

export default config;
