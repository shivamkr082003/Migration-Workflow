import { existsSync } from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config } from "../config.js";
import { errorHandler, notFoundHandler, requestLogger } from "./middleware.js";
import { api } from "./routes.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: config.NODE_ENV === "production" ? undefined : false }));
  app.use(cors({ origin: config.CORS_ORIGIN.split(",").map((s) => s.trim()), exposedHeaders: ["x-request-id"] }));
  app.use(express.json({ limit: "1mb" }));
  app.use(requestLogger);

  app.use("/api", api);
  app.use("/api", notFoundHandler);

  // In production the API also serves the built React app, so the whole product is one deployable service.
  if (existsSync(config.WEB_DIST_DIR)) {
    app.use(express.static(config.WEB_DIST_DIR, { index: false, maxAge: "1h" }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(config.WEB_DIST_DIR, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
