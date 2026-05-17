import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import type { DB } from "../infrastructure/db";
import type { Queue } from "../infrastructure/queue";
import type { CircuitBreaker } from "../domain/usage";
import { publicApi } from "../public-api";
import { adminUi } from "../admin-ui";

export interface AppArgs {
  db: DB;
  queue: Queue;
  bearerToken: string;
  sessionSecret: string;
  adminPasswordHash: string;
  authorSlug: string;
  artifactsLocalPath: string;
  artifactsPublicBaseUrl: string;
  circuitBreaker: CircuitBreaker;
  bootedAt: Date;
}

export function buildApp(args: AppArgs): Elysia {
  return new Elysia()
    .use(staticPlugin({ assets: args.artifactsLocalPath, prefix: "/artifacts" }))
    .use(publicApi({ db: args.db, bearerToken: args.bearerToken, bootedAt: args.bootedAt }))
    .use(
      adminUi({
        db: args.db,
        queue: args.queue,
        sessionSecret: args.sessionSecret,
        adminPasswordHash: args.adminPasswordHash,
        authorSlug: args.authorSlug,
        artifactsPublicBaseUrl: args.artifactsPublicBaseUrl,
        circuitBreaker: args.circuitBreaker,
      })
    );
}
