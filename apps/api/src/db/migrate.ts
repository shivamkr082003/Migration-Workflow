import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./client.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// src/db/ when run with tsx, dist/ when bundled: look for the package's drizzle/ folder in either layout.
export const MIGRATIONS_DIR =
  [path.resolve(here, "../drizzle"), path.resolve(here, "../../drizzle")].find((p) => existsSync(p)) ?? path.resolve(here, "../../drizzle");

export async function runMigrations() {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
