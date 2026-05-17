import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Elysia } from "elysia";
import * as schema from "../../src/infrastructure/db/schema";
import { AdminAuth, requireAdminSession } from "../../src/infrastructure/http/auth-session";
import { authActions } from "../../src/admin-ui/actions/auth";

function makeDb() {
  const sqlite = new Database(":memory:");
  sqlite.run(`
    CREATE TABLE admin_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return drizzle(sqlite, { schema });
}

describe("admin auth", () => {
  const SECRET = "0".repeat(32);
  let app: Elysia;
  let auth: AdminAuth;
  let adminPasswordHash: string;

  beforeEach(async () => {
    const db = makeDb();
    auth = new AdminAuth(db, SECRET);
    adminPasswordHash = await Bun.password.hash("password123");
    app = new Elysia()
      .use(authActions({ auth, adminPasswordHash }))
      .use(requireAdminSession(auth))
      .get("/admin", () => "OK");
  });

  test("GET /admin redirects to /admin/login when unauth", async () => {
    const r = await app.handle(new Request("http://localhost/admin"));
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/admin/login");
  });

  test("login + GET /admin succeeds with session cookie", async () => {
    const form = new FormData();
    form.set("password", "password123");
    const loginResp = await app.handle(
      new Request("http://localhost/admin/login/submit", { method: "POST", body: form })
    );
    expect(loginResp.status).toBe(302);
    const setCookie = loginResp.headers.get("set-cookie");
    if (!setCookie) throw new Error("Expected set-cookie header");
    const cookieVal = setCookie.split(";")[0];
    if (!cookieVal) throw new Error("Expected cookie value");
    const r = await app.handle(
      new Request("http://localhost/admin", { headers: { cookie: cookieVal } })
    );
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("OK");
  });

  test("invalid password returns 401 with login page", async () => {
    const form = new FormData();
    form.set("password", "wrong");
    const r = await app.handle(
      new Request("http://localhost/admin/login/submit", { method: "POST", body: form })
    );
    expect(r.status).toBe(401);
    expect(await r.text()).toContain("Invalid password");
  });
});
