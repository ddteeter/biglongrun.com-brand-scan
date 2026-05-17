import { Elysia, type AnyElysia } from "elysia";
import type { DB } from "../infrastructure/db";
import { bearerAuth } from "../infrastructure/http";
import { healthRoute } from "./health";
import { brandsRoute } from "./brands";
import { sizeChartsRoute } from "./size-charts";
import { scoreHistoryRoute } from "./score-history";

export interface PublicApiArgs {
  db: DB;
  bearerToken: string;
  bootedAt: Date;
}

export function publicApi(args: PublicApiArgs): AnyElysia {
  return new Elysia()
    .use(bearerAuth(args.bearerToken))
    .use(healthRoute({ db: args.db, bootedAt: args.bootedAt }))
    .use(brandsRoute({ db: args.db }))
    .use(sizeChartsRoute({ db: args.db }))
    .use(scoreHistoryRoute({ db: args.db }));
}
