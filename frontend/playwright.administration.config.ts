import {defineConfig, devices} from "@playwright/test";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {randomBytes} from "node:crypto";

// A new, empty database per run. No operational DB, real accounts or photos.
const temporary = mkdtempSync(path.join(tmpdir(), "yokohama-admin-e2e-"));
const backend = path.resolve(__dirname, "../backend");
const apiKey = randomBytes(32).toString("hex");
const python = process.env.YOKOHAMA_TEST_PYTHON || path.join(backend, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
process.env.YOKOHAMA_ADMIN_TEST_URL = "http://127.0.0.1:3006";
process.env.YOKOHAMA_DASHBOARD_TEST_URL = process.env.YOKOHAMA_ADMIN_TEST_URL;
process.env.YOKOHAMA_CALENDAR_TEST_URL = process.env.YOKOHAMA_ADMIN_TEST_URL;
process.env.YOKOHAMA_VISUAL_TEST_URL = process.env.YOKOHAMA_ADMIN_TEST_URL;

export default defineConfig({
  testDir: "./e2e", testMatch: ["administration*.spec.ts", "accounts*.spec.ts", "dashboard.spec.ts", "dashboard-helpers.spec.ts", "calendar-admin.spec.ts"],
  workers: 1, fullyParallel: false, timeout: 120_000, expect: {timeout: 30_000}, reporter: "list",
  outputDir: "test-results-administration", use: {...devices["Desktop Chrome"], channel: "chromium", baseURL: "http://127.0.0.1:3006", screenshot: "only-on-failure", trace: "retain-on-failure"},
  webServer: [
    {command: `"${python}" -m uvicorn app.main:app --host 127.0.0.1 --port 8006`, cwd: backend, url: "http://127.0.0.1:8006/health", reuseExistingServer: false, timeout: 120_000,
      env: {YOKOHAMA_DATABASE_URL: `sqlite:///${path.join(temporary, "fleet.db").replaceAll("\\", "/")}`, YOKOHAMA_API_KEY: apiKey, YOKOHAMA_SETUP_TOKEN: "isolated-test-setup-token-not-production-2026", YOKOHAMA_REQUIRE_AUTH: "true"}},
    {command: `"${process.execPath}" node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3006`, cwd: __dirname, url: "http://127.0.0.1:3006/acceso", reuseExistingServer: false, timeout: 180_000,
      env: {YOKOHAMA_API_URL: "http://127.0.0.1:8006", YOKOHAMA_API_KEY: apiKey, YOKOHAMA_BUILD_DIR: ".next-administration-e2e", NEXT_PUBLIC_YOKOHAMA_PROPOSAL_MODE: "false"}},
  ],
});
