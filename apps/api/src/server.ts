import { config } from "./config.js";
import { pool } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { createApp } from "./http/app.js";
import { logger } from "./logger.js";
import { inputs, seedIfEmpty } from "./services/inputs.js";
import { recoverInterruptedWork } from "./services/system.js";

async function main() {
  inputs(); // validate provided input files before accepting traffic
  await runMigrations();
  await seedIfEmpty();
  await recoverInterruptedWork();

  const server = createApp().listen(config.PORT, () => logger.info({ port: config.PORT, env: config.NODE_ENV }, "api listening"));

  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    server.close(() => void pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.fatal({ err }, "failed to start");
  process.exit(1);
});
