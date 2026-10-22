import {defineConfig, devices} from "@playwright/test";

// Read-only presentation QA: isolated frontend and synthetic API fixtures only.
export default defineConfig({
  testDir: "./e2e", testMatch: "presentation.spec.ts", workers: 1,
  fullyParallel: false, timeout: 150_000, expect: {timeout: 30_000}, reporter: "list",
  outputDir: "test-results-presentation",
  use: {...devices["Desktop Chrome"], channel: "chromium", baseURL: "http://127.0.0.1:3016",
    screenshot: "only-on-failure", trace: "retain-on-failure", serviceWorkers: "block"},
  webServer: {
    command: `"${process.execPath}" node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3016`,
    cwd: __dirname, url: "http://127.0.0.1:3016/acceso", reuseExistingServer: false, timeout: 240_000,
    env: {YOKOHAMA_API_URL: "http://127.0.0.1:8016", YOKOHAMA_API_KEY: "synthetic-presentation-only-not-production",
      YOKOHAMA_DEPLOYMENT_MODE: "local", YOKOHAMA_BUILD_DIR: ".next-presentation-e2e", NEXT_PUBLIC_YOKOHAMA_PROPOSAL_MODE: "false"},
  },
});
