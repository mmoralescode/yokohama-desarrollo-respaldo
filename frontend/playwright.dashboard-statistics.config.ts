import {defineConfig, devices} from "@playwright/test";

process.env.YOKOHAMA_PROPOSAL_TEST_URL = "http://127.0.0.1:3013";
export default defineConfig({
  testDir: "./e2e", testMatch: ["public-dashboard.spec.ts", "proposal-evidence-helpers.spec.ts"], workers: 1,
  fullyParallel: false, timeout: 120_000, expect: {timeout: 30_000}, reporter: "list",
  outputDir: "test-results-dashboard-statistics", use: {...devices["Desktop Chrome"], channel: "chromium",
    baseURL: "http://127.0.0.1:3013", screenshot: "only-on-failure", trace: "retain-on-failure"},
  webServer: {command: `"${process.execPath}" node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3013`,
    cwd: __dirname, url: "http://127.0.0.1:3013", reuseExistingServer: false, timeout: 180_000,
    env: {YOKOHAMA_BUILD_DIR: ".next-dashboard-statistics-e2e", NEXT_PUBLIC_YOKOHAMA_PROPOSAL_MODE: "true"}},
});
