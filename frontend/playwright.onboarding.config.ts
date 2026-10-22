import {defineConfig, devices} from "@playwright/test";

// Browser requests are all fulfilled by synthetic fixtures; no backend runs.
export default defineConfig({
  testDir: "./e2e", testMatch: ["onboarding-simplification.spec.ts", "registration-simplification.spec.ts", "document-photos.spec.ts"],
  workers: 1, fullyParallel: false, timeout: 120_000, expect: {timeout: 30_000}, reporter: "list",
  outputDir: "test-results-onboarding",
  use: {...devices["Desktop Chrome"], channel: "chromium", baseURL: "http://127.0.0.1:3013", screenshot: "only-on-failure", trace: "retain-on-failure"},
  webServer: {
    command: `"${process.execPath}" node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3013`,
    cwd: __dirname, url: "http://127.0.0.1:3013/acceso", reuseExistingServer: false, timeout: 180_000,
    env: {YOKOHAMA_API_URL: "http://127.0.0.1:8013", YOKOHAMA_API_KEY: "synthetic-onboarding-tests-only-not-production", YOKOHAMA_DEPLOYMENT_MODE: "local", YOKOHAMA_BUILD_DIR: ".next-onboarding-e2e", NEXT_PUBLIC_YOKOHAMA_PROPOSAL_MODE: "false"},
  },
});
