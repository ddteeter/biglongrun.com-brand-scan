import { Elysia, type AnyElysia } from "elysia";
import type { DB } from "../infrastructure/db";
import type { Queue } from "../infrastructure/queue";
import type { CircuitBreaker } from "../domain/usage";
import { AdminAuth, requireAdminSession } from "../infrastructure/http/auth-session";
import { BrandItemService } from "../domain/catalog";
import { authActions } from "./actions/auth";
import { brandActions } from "./actions/brand";
import { sourceActions } from "./actions/source";
import { queueActions } from "./actions/queue";
import { itemActions } from "./actions/item";
import { assessmentActions } from "./actions/assessment";
import { suggestionActions } from "./actions/suggestion";
import { dashboardRoute } from "./pages/dashboard";
import { brandsListRoute } from "./pages/brands-list";
import { brandDetailRoute } from "./pages/brand-detail";
import { queueRoute } from "./pages/queue";
import { cohortRoute } from "./pages/cohort";
import { jobsRoute } from "./pages/jobs";
import { usageRoute } from "./pages/usage";
import { settingsRoute } from "./pages/settings";
import { assessmentEditRoute } from "./pages/assessment-edit-route";
import { assessmentsGlobalRoute } from "./pages/assessments-global-route";
import { suggestionsQueueRoute } from "./pages/suggestions-queue";

export interface AdminUiArgs {
  db: DB;
  queue: Queue;
  sessionSecret: string;
  adminPasswordHash: string;
  authorSlug: string;
  artifactsPublicBaseUrl: string;
  circuitBreaker: CircuitBreaker;
}

export function adminUi(args: AdminUiArgs): AnyElysia {
  const auth = new AdminAuth(args.db, args.sessionSecret);
  return new Elysia()
    .use(authActions({ auth, adminPasswordHash: args.adminPasswordHash }))
    .use(requireAdminSession(auth))
    .use(dashboardRoute({ db: args.db, circuitBreaker: args.circuitBreaker }))
    .use(brandsListRoute({ db: args.db }))
    .use(brandDetailRoute({ db: args.db, authorSlug: args.authorSlug }))
    .use(brandActions({ db: args.db }))
    .use(sourceActions({ db: args.db, queue: args.queue }))
    .use(queueRoute({ db: args.db, artifactsPublicBaseUrl: args.artifactsPublicBaseUrl }))
    .use(queueActions({ db: args.db, authorSlug: args.authorSlug }))
    .use(itemActions({ itemService: new BrandItemService(args.db), authorSlug: args.authorSlug }))
    .use(assessmentActions({ db: args.db, authorSlug: args.authorSlug }))
    .use(assessmentEditRoute({ db: args.db }))
    .use(assessmentsGlobalRoute({ db: args.db }))
    .use(suggestionsQueueRoute({ db: args.db }))
    .use(suggestionActions({ db: args.db }))
    .use(cohortRoute({ db: args.db, queue: args.queue }))
    .use(jobsRoute({ db: args.db }))
    .use(usageRoute({ db: args.db }))
    .use(settingsRoute());
}
