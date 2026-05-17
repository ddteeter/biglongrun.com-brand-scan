import { createHash, randomBytes, createHmac } from "node:crypto";
import { Elysia } from "elysia";
import { and, eq, gt } from "drizzle-orm";
import type { DB } from "../db";
import { adminSessions } from "../db/schema";

const SESSION_TTL_SECS = 60 * 60 * 24 * 30; // 30 days
const COOKIE_NAME = "brand_scan_session";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function signCookie(value: string, secret: string): string {
  const sig = createHmac("sha256", secret).update(value).digest("hex").slice(0, 32);
  return `${value}.${sig}`;
}

function verifyCookie(signed: string, secret: string): string | null {
  const dot = signed.lastIndexOf(".");
  if (dot < 1) return null;
  const value = signed.slice(0, dot);
  const sig = signed.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(value).digest("hex").slice(0, 32);
  return sig === expected ? value : null;
}

function parseCookieHeader(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k?.trim() === name && v !== undefined) return decodeURIComponent(v.trim());
  }
  return undefined;
}

export class AdminAuth {
  constructor(
    private readonly db: DB,
    private readonly sessionSecret: string
  ) {}

  async createSession(): Promise<string> {
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECS * 1000).toISOString();
    await this.db.insert(adminSessions).values({
      sessionTokenHash: hashToken(token),
      expiresAt,
    });
    return signCookie(token, this.sessionSecret);
  }

  async resolveSession(signedCookie: string | undefined): Promise<boolean> {
    if (!signedCookie) return false;
    const token = verifyCookie(signedCookie, this.sessionSecret);
    if (!token) return false;
    const nowIso = new Date().toISOString();
    const [row] = await this.db
      .select()
      .from(adminSessions)
      .where(
        and(
          eq(adminSessions.sessionTokenHash, hashToken(token)),
          gt(adminSessions.expiresAt, nowIso)
        )
      )
      .limit(1);
    if (!row) return false;
    await this.db
      .update(adminSessions)
      .set({ lastSeenAt: nowIso })
      .where(eq(adminSessions.id, row.id));
    return true;
  }

  async destroySession(signedCookie: string | undefined): Promise<void> {
    if (!signedCookie) return;
    const token = verifyCookie(signedCookie, this.sessionSecret);
    if (!token) return;
    await this.db.delete(adminSessions).where(eq(adminSessions.sessionTokenHash, hashToken(token)));
  }

  static cookieName(): string {
    return COOKIE_NAME;
  }
}

export function requireAdminSession(auth: AdminAuth) {
  return new Elysia({ name: "require-admin-session" }).onRequest(async ({ request, set }) => {
    const path = new URL(request.url).pathname;
    if (path === "/admin/login" || path === "/admin/login/submit") return;
    if (!path.startsWith("/admin")) return;
    const rawCookie = request.headers.get("cookie");
    const cookieVal = parseCookieHeader(rawCookie, AdminAuth.cookieName());
    const ok = await auth.resolveSession(cookieVal);
    if (!ok) {
      set.status = 302;
      set.headers.location = "/admin/login";
      return new Response(null, { status: 302, headers: { location: "/admin/login" } });
    }
  });
}
