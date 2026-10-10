import { defineConfig, devices } from "@playwright/test";

const PORT = 4300;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Builds the UI and serves it from the API, exactly like production, against a dedicated database.
    command: `pnpm --filter web build && cd apps/api && npx tsx src/server.ts`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      NODE_ENV: "production",
      LOG_LEVEL: "warn",
      ANTHROPIC_API_KEY: "",
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://workbench:workbench@localhost:5433/workbench_e2e",
    },
  },
});
