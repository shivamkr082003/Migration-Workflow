import { randomUUID } from "node:crypto";
import type { ErrorRequestHandler, Request, RequestHandler } from "express";
import { pinoHttp } from "pino-http";
import { z, ZodError } from "zod";
import { AppError } from "../errors.js";
import { logger } from "../logger.js";

export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers["x-request-id"];
    const id = typeof incoming === "string" && /^[\w-]{1,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader("x-request-id", id);
    return id;
  },
  autoLogging: { ignore: (req) => req.url === "/api/health" },
  customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
});

/** Who is acting. There is no auth in this demo; the reviewer's name is sent by the UI and recorded in history. */
export function actor(req: Request): string {
  const raw = req.header("x-actor")?.trim();
  return raw && raw.length <= 60 ? raw.replace(/[^\p{L}\p{N} .@_'-]/gu, "") || "anonymous" : "anonymous";
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const res = schema.safeParse(data);
  if (!res.success) throw new AppError(400, "VALIDATION_ERROR", "Request is invalid", res.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  return res.data;
}

export const notFoundHandler: RequestHandler = (req, _res, next) => next(new AppError(404, "ROUTE_NOT_FOUND", `No route for ${req.method} ${req.path}`));

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = String(req.id ?? "");
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details ?? null, requestId } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Request is invalid", details: err.issues, requestId } });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "MALFORMED_JSON", message: "Request body is not valid JSON", details: null, requestId } });
    return;
  }
  req.log.error({ err }, "unhandled error");
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Quote the request id when reporting it.", details: null, requestId } });
};
