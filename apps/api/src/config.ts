import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));
const bool = z.enum(["true", "false"]).transform((v) => v === "true");

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().url().default("postgres://workbench:workbench@localhost:5433/workbench"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATA_DIR: z.string().default(path.resolve(here, "../../../data")),
  WEB_DIST_DIR: z.string().default(path.resolve(here, "../../web/dist")),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  ANTHROPIC_API_KEY: z.string().optional(),
  AGENT_MODEL: z.string().default("claude-opus-5-5"),
  AGENT_MAX_TURNS: z.coerce.number().int().min(2).max(40).default(20),
  ALLOW_FAULT_INJECTION: bool.default(true),
  ALLOW_RESET: bool.default(true),
});

export type Config = z.infer<typeof Env>;
export const config: Config = Env.parse(process.env);
