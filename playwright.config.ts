import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

// End-to-end tests: `npm run test:e2e`. Builds the app and serves it on its own port with
// recorded job boards and AI answers (USE_FIXTURES=1), against the dev database from .env.
// Never point this at production: tests sign up throwaway accounts and delete them.
const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: "list",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `${baseURL}/api/v1/health`,
    timeout: 300_000,
    reuseExistingServer: false,
    // Writes are only accepted from APP_URL; the server must accept its own test origin.
    env: { USE_FIXTURES: "1", APP_URL: baseURL, CUES_PROVIDER: "" },
  },
});
