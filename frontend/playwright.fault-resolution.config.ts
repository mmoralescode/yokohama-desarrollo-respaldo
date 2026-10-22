import {defineConfig, devices} from "@playwright/test";

export default defineConfig({
  testDir: "./e2e", testMatch: "fault-resolution.proposal.spec.ts",
  workers: 1, fullyParallel: false, timeout: 120_000, expect: {timeout: 30_000}, reporter: "list",
  outputDir: "test-results-fault-resolution",
  use: {...devices["Desktop Chrome"], channel: "chromium", baseURL: "http://127.0.0.1:3014", screenshot: "only-on-failure", trace: "retain-on-failure"},
  webServer: {command: `"${process.execPath}" node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3014`, cwd: __dirname, url: "http://127.0.0.1:3014", reuseExistingServer: false, timeout: 180_000,
    env: {YOKOHAMA_BUILD_DIR: ".next-fault-resolution-e2e", NEXT_PUBLIC_YOKOHAMA_PROPOSAL_MODE: "true"}},
});
