import { describe, expect, it } from "vitest";
import { api, get, post } from "./helpers.js";

describe("HTTP contract", () => {
  it("serves health and metadata", async () => {
    expect((await get("/health")).body).toEqual({ status: "ok" });
    const meta = (await get("/meta")).body;
    expect(meta).toMatchObject({ sampleSize: 153, maxSampleSize: 500, agent: { default: "heuristic", claude: false } });
    expect(meta.rules.length).toBeGreaterThan(10);
  });

  it("returns a consistent error envelope with a request id", async () => {
    const res = await get("/versions/not-a-uuid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(res.body.error.requestId).toBe(res.headers["x-request-id"]);

    const missing = await get("/versions/00000000-0000-4000-8000-000000000000");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("NOT_FOUND");

    expect((await get("/nope")).body.error.code).toBe("ROUTE_NOT_FOUND");
  });

  it("rejects malformed JSON bodies", async () => {
    const res = await api().post("/api/admin/reset").set("content-type", "application/json").send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MALFORMED_JSON");
  });

  it("validates fault injection input", async () => {
    const res = await post("/versions/00000000-0000-4000-8000-000000000000/executions", { faultInjection: { failAfterRows: -1 } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("INVALID_FAULT_INJECTION");
  });

  it("propagates a caller-supplied request id", async () => {
    const res = await api().get("/api/health").set("x-request-id", "trace-123");
    expect(res.headers["x-request-id"]).toBe("trace-123");
  });

  it("pages source records and profiles every field", async () => {
    const page = (await get("/source/records?limit=5&offset=150")).body;
    expect(page.total).toBe(153);
    expect(page.items.map((i: { row: number }) => i.row)).toEqual([151, 152, 153]);
    const profile = (await get("/source/profile")).body;
    expect(profile).toHaveLength(11);
  });
});
