import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://workbench:workbench@localhost:5433/workbench_test",
      ANTHROPIC_API_KEY: "",
    },
    // Tests share one database, so files run one after another.
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
    testTimeout: 20_000,
  },
});
