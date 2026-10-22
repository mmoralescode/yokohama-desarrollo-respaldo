import {defineConfig, devices} from "@playwright/test";

// No web server, private database, live accounts or external API is contacted.
export default defineConfig({
  testDir: "./e2e", testMatch: ["cloud-security-helpers.spec.ts", "photo-optimization.spec.ts", "proposal-evidence-helpers.spec.ts", "operational-helpers.spec.ts"],
  workers: 1, fullyParallel: false, timeout: 120_000, expect: {timeout: 15_000}, reporter: "list",
  outputDir: "test-results-cloud-security",
  use: {...devices["Desktop Chrome"], channel: "chromium", trace: "retain-on-failure"},
});
