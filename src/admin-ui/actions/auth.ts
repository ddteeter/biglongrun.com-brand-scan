import { Elysia } from "elysia";
import { cookie } from "@elysiajs/cookie";
import { serialize } from "cookie";
import { AdminAuth } from "../../infrastructure/http/auth-session";
import { LoginPage } from "../pages/login";

export interface AuthActionsArgs {
  auth: AdminAuth;
  adminPasswordHash: string;
}

export function authActions(args: AuthActionsArgs): Elysia {
  return new Elysia()
    .use(cookie())
    .get(
      "/admin/login",
      () =>
        new Response(`<!DOCTYPE html>${LoginPage({})}`, {
          headers: { "content-type": "text/html" },
        })
    )
    .post("/admin/login/submit", async ({ request }) => {
      const form = await request.formData();
      const raw = form.get("password");
      const password = typeof raw === "string" ? raw : "";
      const ok = await Bun.password.verify(password, args.adminPasswordHash);
      if (!ok) {
        return new Response(`<!DOCTYPE html>${LoginPage({ error: "Invalid password" })}`, {
          status: 401,
          headers: { "content-type": "text/html" },
        });
      }
      const cookieValue = await args.auth.createSession();
      const cookieStr = serialize(AdminAuth.cookieName(), cookieValue, {
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
      return new Response(null, {
        status: 302,
        headers: { location: "/admin", "set-cookie": cookieStr },
      });
    })
    .post("/admin/logout", async ({ cookie: c }) => {
      await args.auth.destroySession(c[AdminAuth.cookieName()]);
      const cookieStr = serialize(AdminAuth.cookieName(), "", {
        expires: new Date("Thu, Jan 01 1970 00:00:00 UTC"),
        path: "/",
      });
      return new Response(null, {
        status: 302,
        headers: { location: "/admin/login", "set-cookie": cookieStr },
      });
    });
}
