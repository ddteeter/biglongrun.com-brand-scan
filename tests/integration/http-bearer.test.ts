import { describe, test, expect } from "bun:test";
import { Elysia } from "elysia";
import { bearerAuth } from "../../src/infrastructure/http/auth-bearer";

describe("bearerAuth", () => {
  const app = new Elysia()
    .use(bearerAuth("expected"))
    .get("/api/v1/health", () => ({ ok: true }))
    .get("/api/v1/brands", () => ({ brands: [] }));

  test("allows /health without auth", async () => {
    const r = await app.handle(new Request("http://localhost/api/v1/health"));
    expect(r.status).toBe(200);
  });

  test("rejects request without bearer", async () => {
    const r = await app.handle(new Request("http://localhost/api/v1/brands"));
    expect(r.status).toBe(401);
    expect(r.headers.get("content-type")).toContain("application/problem+json");
  });

  test("accepts valid bearer", async () => {
    const r = await app.handle(
      new Request("http://localhost/api/v1/brands", {
        headers: { authorization: "Bearer expected" },
      })
    );
    expect(r.status).toBe(200);
  });

  test("rejects wrong bearer", async () => {
    const r = await app.handle(
      new Request("http://localhost/api/v1/brands", {
        headers: { authorization: "Bearer wrong" },
      })
    );
    expect(r.status).toBe(401);
  });
});
