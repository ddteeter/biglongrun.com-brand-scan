import { Elysia } from "elysia";
import { problemDetailsResponse, ProblemTypes } from "./problem-details";

export function bearerAuth(expectedToken: string) {
  return new Elysia({ name: "bearer-auth" }).onRequest(({ request, set }) => {
    const pathname = new URL(request.url).pathname;
    // Only enforce bearer auth on /api/v1/* routes (health is public)
    if (!pathname.startsWith("/api/v1/") || pathname === "/api/v1/health") return;
    const auth = request.headers.get("authorization");
    if (!auth || !auth.startsWith("Bearer ") || auth.slice("Bearer ".length) !== expectedToken) {
      set.status = 401;
      return problemDetailsResponse({
        type: ProblemTypes.Unauthorized,
        title: "Unauthorized",
        status: 401,
        detail: "Missing or invalid bearer token.",
      });
    }
  });
}
