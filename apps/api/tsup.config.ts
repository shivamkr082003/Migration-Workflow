import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/db/migrate-cli.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Bundle the workspace core package; keep real npm dependencies external.
  noExternal: ["@mw/core"],
});
