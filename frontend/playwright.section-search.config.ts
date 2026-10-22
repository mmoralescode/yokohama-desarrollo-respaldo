import {defineConfig, devices} from "@playwright/test";

// Isolated frontend, synthetic API responses only; no backend or real accounts.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "section-search.spec.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: {timeout: 20_000},
  reporter: "list",
  outputDir: "test-results-section-search",
  use: {
    ...devices["Desktop Chrome"], channel: "chromium", baseURL: "http://127.0.0.1:3015",
    screenshot: "only-on-failure", trace: "retain-on-failure", serviceWorkers: "block",
  },
  webServer: {
    command: `"${process.execPath}" node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3015`,
    cwd: __dirname,
    url: "http://127.0.0.1:3015/acceso",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      YOKOHAMA_API_URL: "http://127.0.0.1:8015",
      YOKOHAMA_API_KEY: "synthetic-section-search-tests-only-not-production",
      YOKOHAMA_DEPLOYMENT_MODE: "local",
      YOKOHAMA_BUILD_DIR: ".next-section-search-e2e",
      NEXT_PUBLIC_YOKOHAMA_PROPOSAL_MODE: "false",
    },
  },
});
