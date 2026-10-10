import { afterAll, beforeAll, beforeEach } from "vitest";
import { pool } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { resetDemo } from "../src/services/system.js";

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  await resetDemo("test");
});

afterAll(async () => {
  await pool.end();
});
