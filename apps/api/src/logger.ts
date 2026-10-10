import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: config.NODE_ENV === "test" ? "silent" : config.LOG_LEVEL,
  base: { service: "migration-workbench-api" },
  redact: ["req.headers.authorization", "req.headers.cookie", "*.apiKey"],
  ...(config.NODE_ENV === "development" ? { transport: { target: "pino-pretty", options: { singleLine: true } } } : {}),
});
