import {defineConfig, devices} from "@playwright/test";

// Every API request is fulfilled with synthetic fixtures; no backend is started.
export default defineConfig({
  testDir: "./e2e", testMatch: "developer-access.spec.ts",
  workers: 1, fullyParallel: false, timeout: 120_000, expect: {timeout: 30_000}, reporter: "list",
  outputDir: "test-results-developer-access",
  use: {...devices["Desktop Chrome"], channel: "chromium", baseURL: "http://127.0.0.1:3014", screenshot: "only-on-failure", trace: "retain-on-failure"},
  webServer: {
    command: `"${process.execPath}" node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3014`,
    cwd: __dirname, url: "http://127.0.0.1:3014/acceso", reuseExistingServer: false, timeout: 180_000,
    env: {YOKOHAMA_API_URL: "http://127.0.0.1:8014", YOKOHAMA_API_KEY: "synthetic-developer-access-tests-only", YOKOHAMA_DEPLOYMENT_MODE: "local", YOKOHAMA_BUILD_DIR: ".next-developer-admin-e2e", NEXT_PUBLIC_YOKOHAMA_PROPOSAL_MODE: "false"},
  },
});
