# brand-scan Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Passive brand-discovery pipeline. The service polls a curated set of running-focused subreddits, extracts brand mentions via Claude Haiku, dedupes against the existing brand index and prior suggestions, and surfaces new candidates in an admin "Suggested brands" queue. The editor reviews each suggestion, optionally provides a primary URL, and one click promotes a suggestion into a real `brands` row. Plus-size-context mentions are flagged so the editor can prioritize the brands that matter most for size-inclusivity coverage.

**Architecture:** Adds one schema table (`brand_suggestions`), one domain service (`BrandSuggestionService`), one Reddit RSS client, one Claude-Haiku extractor, one job handler + scheduled cron, one admin UI page + actions. No public API surface (suggestions are editor-only).

**Tech Stack:** Same as phases 1-3.

**Spec reference:** `docs/superpowers/specs/2026-05-16-brand-scan-design.md`
**Previous plans:** `docs/superpowers/plans/2026-05-16-brand-scan-phase-{1,2,3}.md`

**Phase 4 scope (REDUCED from spec):**

- ✅ `brand_suggestions` table + admin queue
- ✅ Reddit RSS ingestion + Claude-Haiku brand extraction
- ✅ Plus-size priority flag on suggestions
- ❌ Seed importers (Running Warehouse, REI, Fleet Feet) — **SKIPPED**. One-time bulk import for ~30-50 brands is YAGNI; manual entry via the admin UI is ~10 minutes total. Same YAGNI lesson as the blog-backfill CLI.

**Out of scope (deferred):**
- Eden client + summary digest (phase 5)
- Email-as-signal change detection (future)
- Authenticated Reddit API access for comment-level extraction — start with RSS-only (post title + selftext); revisit if signal is thin

**Conventions inherited from phases 1-3 (in `CLAUDE.md`):**

1. Strict TypeScript, no `!` non-null assertions, ESLint strict + unicorn + sonarjs
2. Service pattern for multi-step writes (transactions inside services)
3. dep-cruiser: `src/admin-ui/actions/**` cannot import schema tables
4. `getEnv()` lazy getter
5. `estimateAnthropicCost(usage, model)` for cost — no inline arithmetic
6. Migration naming: `bun run db:generate -- --name <snake_case>`
7. Tests: unit (pure), integration (in-memory bun:sqlite + raw DDL), E2E (Playwright)
8. Pre-commit must pass
9. One commit per task

## Subreddit configuration

Initial list (verified via HTTP 200 on `/r/<name>/.rss`):

```typescript
// src/domain/suggestions/subreddits.ts
export const MONITORED_SUBREDDITS = [
  "running",            // largest community; high volume, noisy
  "AdvancedRunning",    // performance-focused; premium brands
  "Ultramarathon",      // gear-obsessive community; surfaces boutique brands others won't
  "trailrunning",       // trail-specific brands
  "RunningFashion",     // style-forward, surfaces boutique brands
  "runninggear",        // directly gear-focused
  "PlusSizeFitness",    // primary signal source for size-inclusivity coverage
] as const;
```

Stored as a single config constant so the list can be edited without touching ingestion logic. To add a subreddit later: append the name (without the `r/` prefix) to the array, deploy.

`PlusSizeFitness` mentions get a `plus_size_priority: true` flag on resulting suggestions for editorial triage.

## File Structure

Additions:

```
src/
├── domain/
│   └── suggestions/                    ← NEW MODULE
│       ├── index.ts                    barrel
│       ├── types.ts                    NewSuggestionInput Zod schema + types
│       ├── service.ts                  BrandSuggestionService (list, create, accept, reject; tx-wrapped accept)
│       ├── subreddits.ts               MONITORED_SUBREDDITS constant
│       ├── reddit-client.ts            RedditRssClient: fetch RSS, parse items
│       ├── extractor.ts                extractBrandMentions: Claude-Haiku call returning structured brand candidates
│       └── ingest.ts                   ingestSubreddit orchestrator (fetch → extract → dedupe → upsert suggestions)
├── infrastructure/db/schema/
│   └── suggestions.ts                  brand_suggestions table
├── jobs/
│   ├── sweep-reddit-suggestions.ts     fans out per-subreddit ingest jobs
│   └── ingest-subreddit.ts             single-subreddit handler
├── admin-ui/
│   ├── pages/
│   │   └── suggestions-queue.tsx       /admin/suggestions
│   └── actions/
│       └── suggestion.ts               POST accept/reject

drizzle/
└── 0004_brand_suggestions.sql

tests/
├── unit/
│   └── suggestions/
│       ├── reddit-rss-parser.test.ts
│       └── extractor.test.ts
├── integration/
│   ├── suggestions-schema.test.ts
│   ├── brand-suggestion-service.test.ts
│   ├── ingest-subreddit.test.ts
│   └── admin-suggestion-actions.test.ts
└── e2e/
    └── suggestion-accept.spec.ts
```

## Task Groups

- **Group A — Schema + service** (Tasks 1–2)
- **Group B — Reddit ingestion** (Tasks 3–5)
- **Group C — Admin UI** (Task 6)
- **Group D — Wiring + polish** (Tasks 7–8)

8 tasks total.

---

## Group A — Schema + service

### Task 1: `brand_suggestions` schema + migration

**Files:**
- Create: `src/infrastructure/db/schema/suggestions.ts`
- Update: `src/infrastructure/db/schema/index.ts` (append `export * from "./suggestions"`)
- Generate: `drizzle/0004_brand_suggestions.sql` via `bun run db:generate -- --name brand_suggestions`
- Test: `tests/integration/suggestions-schema.test.ts`

Shape (extends the spec's section 5.6 with the plus-size priority field):

```typescript
import { sql } from "drizzle-orm";
import { sqliteTable, integer, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { brands } from "./brands";

export const brandSuggestions = sqliteTable(
  "brand_suggestions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    suggestedBrandName: text("suggested_brand_name").notNull(),
    suggestedSlug: text("suggested_slug").notNull(),
    suggestedUrl: text("suggested_url"),
    source: text("source", { enum: ["reddit"] }).notNull(),
    sourceSubreddit: text("source_subreddit"),
    sourcePostUrl: text("source_post_url"),
    sourcePostTitle: text("source_post_title"),
    sourceContext: text("source_context"),
    plusSizePriority: integer("plus_size_priority", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: ["pending", "accepted", "rejected"] }).notNull().default("pending"),
    suggestedAt: text("suggested_at").notNull().default(sql`(datetime('now'))`),
    resolvedAt: text("resolved_at"),
    resolvedBrandId: integer("resolved_brand_id").references(() => brands.id, { onDelete: "set null" }),
    resolutionNote: text("resolution_note"),
    rejectionReason: text("rejection_reason"),
  },
  (t) => [uniqueIndex("brand_suggestions_pending_slug_unique").on(t.suggestedSlug, t.status)],
);
```

The unique index on `(suggested_slug, status)` enforces "only one pending suggestion per slug" — the dedupe boundary. Multiple rejected/accepted rows for the same slug are allowed (history).

Integration test (TDD): insert a pending suggestion; insert a second pending with same slug → should fail; insert with same slug but `status='rejected'` → should succeed; cascade-on-brand-delete sets `resolved_brand_id` to NULL.

Commit: `feat: brand_suggestions schema + migration`.

### Task 2: `BrandSuggestionService`

**Files:**
- Create: `src/domain/suggestions/types.ts`, `service.ts`, `index.ts`
- Test: `tests/integration/brand-suggestion-service.test.ts`

API:

```typescript
// types.ts
export const NewSuggestionInputSchema = z.object({
  suggestedBrandName: z.string().min(1).max(200),
  suggestedSlug: z.string().min(1).max(200),
  suggestedUrl: z.string().url().nullable().optional(),
  sourceSubreddit: z.string().min(1).max(100),
  sourcePostUrl: z.url(),
  sourcePostTitle: z.string().min(1),
  sourceContext: z.string().optional(),
  plusSizePriority: z.boolean().default(false),
});

export const AcceptSuggestionInputSchema = z.object({
  id: z.number().int().positive(),
  primaryUrl: z.string().url(),
});

export const RejectSuggestionInputSchema = z.object({
  id: z.number().int().positive(),
  reason: z.string().min(1).max(500),
});
```

Service methods:

- `listPending()` — pending suggestions, plus-size-priority first then newest
- `listByStatus(status)` — for resolved-history views
- `findById(id)`
- `create(raw)` — Zod-validate then INSERT; if `unique(suggested_slug, status)` collides on a pending row → return the existing one (idempotent on dedupe)
- `accept(raw)` — tx-wrapped: load suggestion → if not pending throw → instantiate `BrandService(tx)` → `brandService.create({ name: suggestion.suggestedBrandName, primaryUrl: input.primaryUrl })` → update suggestion to `status='accepted'`, set `resolved_at`, `resolved_brand_id`. Returns `{ brandId, brandSlug }`.
- `reject(raw)` — single-update: set `status='rejected'`, `rejection_reason`, `resolved_at`. Validates reason is non-empty.

Tests:
- create inserts pending suggestion
- create with same `(slug, pending)` returns existing (idempotent)
- create with same slug but prior is `rejected` → new pending row succeeds
- accept creates brand + updates suggestion atomically (verified by querying both tables inside one assertion block; verify rollback if brand-create fails — e.g. simulate a slug collision)
- reject without reason throws
- listPending orders correctly: plus-size-priority first, then by `suggested_at` desc

Commit: `feat: BrandSuggestionService with tx-wrapped accept`.

---

## Group B — Reddit ingestion

### Task 3: Reddit RSS client + parser

**Files:**
- Create: `src/domain/suggestions/reddit-client.ts`
- Update: barrel
- Test: `tests/unit/suggestions/reddit-rss-parser.test.ts`

Reddit's per-subreddit RSS at `https://www.reddit.com/r/<name>/.rss` returns up to 25 most recent posts as Atom XML. The client:

```typescript
export interface RedditPost {
  id: string;             // Reddit ID (e.g., t3_abc123)
  subreddit: string;
  title: string;
  selftext: string;       // post body (HTML-stripped to plain text)
  url: string;            // permalink to the post
  publishedAt: string;    // ISO timestamp
}

export class RedditRssClient {
  constructor(private readonly fetchFn = globalThis.fetch) {}

  async fetchSubreddit(subreddit: string): Promise<RedditPost[]> {
    const url = `https://www.reddit.com/r/${subreddit}/.rss`;
    const r = await this.fetchFn(url, {
      headers: { "user-agent": "brand-scan/1.0 (contact: drew@drewteeter.com)" },
    });
    if (!r.ok) throw new Error(`Reddit RSS ${subreddit} returned ${String(r.status)}`);
    const xml = await r.text();
    return parseAtomEntries(xml, subreddit);
  }
}
```

`parseAtomEntries` uses `indexOf`-based scanning (sonarjs/slow-regex avoidance, established pattern):

- `<entry>` boundaries — extract one entry at a time
- Within each entry: `<title>`, `<id>`, `<link href="...">`, `<published>`, `<content type="html">`
- `<content>` is HTML — convert to plain text via a minimal `stripHtml(s)` helper (kill `<...>` tags, decode `&lt;`/`&gt;`/`&amp;`/`&quot;`/`&#39;`/`&nbsp;`)
- Skip entries with no title or no permalink

Unit tests:
- Parses a known sample feed (fixture XML string in the test file) into 3 `RedditPost` records with expected fields
- Strips HTML from selftext correctly
- Handles missing `<content>` gracefully (returns empty selftext)
- Skips malformed entries
- Returns empty array on empty feed

Commit: `feat: Reddit RSS client + Atom parser`.

### Task 4: Brand-extraction prompt via Claude Haiku

**Files:**
- Create: `src/domain/suggestions/extractor.ts`
- Update: barrel
- Test: `tests/unit/suggestions/extractor.test.ts`

The extractor takes a single Reddit post and returns zero or more brand candidates. Uses **Claude Haiku 4.5** (cheap; this runs per-post, and 25 posts × 6 subreddits = 150 calls per sweep, so cost matters).

```typescript
import { z } from "zod";
import { AnthropicClient, MODEL_HAIKU } from "../../infrastructure/external";

const CandidatesSchema = z.object({
  candidates: z.array(
    z.object({
      brand_name: z.string().min(1),
      context_excerpt: z.string().max(280),
      plus_size_signal: z.boolean(),
    })
  ),
});

const SYSTEM_PROMPT = `You scan a Reddit post about running for mentions of running-apparel brand names.

Your output: a JSON object with one key, "candidates", an array. Each candidate is:
- brand_name: the brand's display name as commonly known (e.g., "Path Projects", "Tracksmith", "Janji"). Use the canonical brand name, NOT a product line within a brand.
- context_excerpt: a ≤280-character excerpt from the post showing where/how this brand was mentioned.
- plus_size_signal: true ONLY if the brand was mentioned in a clearly plus-size or size-inclusivity context — e.g., the post is about size availability, extended sizes, or the brand was recommended specifically for plus-size runners. Most mentions will be false.

ONLY include brands that:
- Sell running APPAREL (not shoes-only, not nutrition/supplements, not accessories like watches)
- Are mentioned by name in the post

EXCLUDE:
- Shoe-only brands (Hoka, Saucony, Brooks shoe line — these are typically tracked separately)
- Tech brands (Garmin, Coros, Apple, Polar)
- Nutrition/hydration (Maurten, Tailwind, Liquid I.V.)
- Generic mentions like "running brands" without a specific name
- Personal nicknames or unclear references

If no apparel brands are mentioned, return { "candidates": [] }. Be conservative — false positives waste editor review time.`;

export interface ExtractInput {
  client: AnthropicClient;
  post: { title: string; selftext: string; subreddit: string };
}

export interface ExtractedCandidate {
  brandName: string;
  contextExcerpt: string;
  plusSizeSignal: boolean;
}

export interface ExtractResult {
  candidates: ExtractedCandidate[];
  usage: { inputTokens: number; outputTokens: number };
}

export async function extractBrandMentions(input: ExtractInput): Promise<ExtractResult> {
  const resp = await input.client.extractStructured({
    model: MODEL_HAIKU,
    systemPrompt: SYSTEM_PROMPT,
    userText: `Subreddit: r/${input.post.subreddit}\nTitle: ${input.post.title}\n\nBody:\n${input.post.selftext}`,
    maxTokens: 1024,
  });
  const parsed = CandidatesSchema.parse(resp.parsed);
  return {
    candidates: parsed.candidates.map((c) => ({
      brandName: c.brand_name,
      contextExcerpt: c.context_excerpt,
      plusSizeSignal: c.plus_size_signal,
    })),
    usage: resp.usage,
  };
}
```

Tests (with stubbed `AnthropicClient`):
- Parses a successful response into `ExtractedCandidate[]`
- Empty `candidates` array returns empty list
- Validates plus_size_signal mapped to plusSizeSignal correctly

Commit: `feat: Reddit post brand-extraction prompt (Claude Haiku)`.

### Task 5: Ingest orchestrator + job handlers

**Files:**
- Create: `src/domain/suggestions/ingest.ts`, `src/jobs/sweep-reddit-suggestions.ts`, `src/jobs/ingest-subreddit.ts`
- Update: `src/jobs/index.ts`, `src/main.ts` (scheduler + buildIngestDeps)
- Update: `src/domain/suggestions/index.ts` barrel
- Test: `tests/integration/ingest-subreddit.test.ts`

`ingest.ts` orchestrator:

```typescript
export interface IngestDeps {
  redditClient: RedditRssClient;
  anthropic: AnthropicClient;
  suggestionService: BrandSuggestionService;
  brandService: BrandService;
  recordUsage: (input: RecordUsageInput) => Promise<void>;
}

export interface IngestSubredditResult {
  postsFetched: number;
  candidatesProposed: number;
  suggestionsCreated: number;
  suggestionsSkippedExisting: number;   // brand already in brands table
  suggestionsSkippedDuplicate: number;  // suggestion already pending
}

export async function ingestSubreddit(
  deps: IngestDeps,
  subreddit: string,
): Promise<IngestSubredditResult> {
  const posts = await deps.redditClient.fetchSubreddit(subreddit);
  let candidatesProposed = 0;
  let suggestionsCreated = 0;
  let suggestionsSkippedExisting = 0;
  let suggestionsSkippedDuplicate = 0;

  for (const post of posts) {
    const result = await deps.extract(post); // calls extractBrandMentions internally
    await deps.recordUsage({
      provider: "anthropic",
      unitsUsed: result.usage.inputTokens + result.usage.outputTokens,
      unitsKind: "tokens",
      estimatedCostUsd: estimateAnthropicCost(result.usage, MODEL_HAIKU),
    });
    candidatesProposed += result.candidates.length;

    for (const c of result.candidates) {
      const slug = brandSlugFromName(c.brandName);

      // Dedupe layer 1: brand already exists
      const existingBrand = await deps.brandService.findBySlug(slug);
      if (existingBrand) { suggestionsSkippedExisting++; continue; }

      // Dedupe layer 2: pending suggestion already exists (BrandSuggestionService.create is idempotent on slug+pending)
      const before = await deps.suggestionService.countPendingForSlug(slug);

      await deps.suggestionService.create({
        suggestedBrandName: c.brandName,
        suggestedSlug: slug,
        sourceSubreddit: subreddit,
        sourcePostUrl: post.url,
        sourcePostTitle: post.title,
        sourceContext: c.contextExcerpt,
        plusSizePriority: c.plusSizeSignal,
      });

      const after = await deps.suggestionService.countPendingForSlug(slug);
      if (after > before) suggestionsCreated++;
      else suggestionsSkippedDuplicate++;
    }
  }

  return { postsFetched: posts.length, candidatesProposed, suggestionsCreated, suggestionsSkippedExisting, suggestionsSkippedDuplicate };
}
```

Add a `countPendingForSlug(slug)` method to `BrandSuggestionService` to support the dedup check.

`sweep-reddit-suggestions.ts` handler:

```typescript
import { MONITORED_SUBREDDITS } from "../domain/suggestions";
// fan out one job per subreddit; dedupe key includes the week so we don't double-fire mid-week
```

`ingest-subreddit.ts` handler: parses `{ subreddit: string }` payload, instantiates services + ingestDeps, calls `ingestSubreddit(deps, subreddit)`, writes summary into `runs.summary_json`.

Scheduler entry in `src/main.ts`:

```typescript
scheduler.register({
  name: "sweep-reddit-suggestions",
  cron: "0 7 * * 1",  // weekly Mondays 07:00 UTC (after compute-brand-cadence)
  enqueue: () => queue.enqueue({
    jobType: "sweep-reddit-suggestions",
    payload: {},
    dedupeKey: `sweep-reddit:${new Date().toISOString().slice(0, 10)}`,
  }),
});
```

Integration test for `ingest-subreddit`:
- Stubs `RedditRssClient` to return 2 sample posts
- Stubs Claude to return 1 candidate per post (1 in plus-size context, 1 not)
- Seeds one existing brand to verify dedupe path
- Verifies: `runs` row written with the expected summary counts; new suggestions present in `brand_suggestions` with correct `plus_size_priority` values; usage recorded.

Commits:
- `feat: ingestSubreddit orchestrator + countPendingForSlug helper`
- `feat: sweep-reddit-suggestions + ingest-subreddit job handlers + weekly cron`

---

## Group C — Admin UI

### Task 6: /admin/suggestions page + accept/reject actions

**Files:**
- Create: `src/admin-ui/pages/suggestions-queue.tsx`
- Create: `src/admin-ui/actions/suggestion.ts`
- Update: `src/admin-ui/index.ts` (mount GET page + action plugin)
- Update: `src/admin-ui/components/nav.tsx` (add nav item)
- Test: `tests/integration/admin-suggestion-actions.test.ts`

Page renders pending suggestions ordered plus-size-priority first then newest. Each row has columns:
- ⭐ priority indicator (if `plus_size_priority`)
- Brand name (suggested)
- Subreddit
- Reddit post link (opens new tab)
- Context excerpt (truncated to 200 chars)
- Accept form: URL input (required) + Accept button
- Reject form: reason input + Reject button (separate `<form>`)

Action handlers via `BrandSuggestionService.accept({id, primaryUrl})` and `.reject({id, reason})`. Per the existing arch rule, this file MUST NOT import schema tables — only services.

The accept action redirects to `/admin/brands/<new-slug>` so the editor lands on the newly-created brand page to immediately add sources.

Nav entry: `["/admin/suggestions", "Suggestions"]`, ideally with a count badge of pending suggestions (read via the layout if the count is cheap; defer if it complicates the layout). For v1, just the link without a badge.

Integration tests (`admin-suggestion-actions.test.ts`):
- Accept happy path: suggestion → brand created → status='accepted', resolved_brand_id set, redirect URL points to new brand slug
- Accept with invalid URL → 400
- Accept for non-pending suggestion → 400 with a clear message
- Reject without reason → 400
- Reject happy path: status='rejected', rejection_reason populated

Commit: `feat: /admin/suggestions page + accept/reject actions`.

---

## Group D — Wiring + polish

### Task 7: E2E for accept flow + smoke verification

**Files:**
- Create: `tests/e2e/suggestion-accept.spec.ts`
- Update: `tests/e2e/server.ts` (seed at least one pending suggestion at startup so the test isn't always skipped)

E2E flow:
- Login
- Visit `/admin/suggestions`
- If no rows, `test.skip(true, "no pending suggestions seeded")`
- Pick the first pending row, fill the URL field with `https://example.com`, click Accept
- After redirect, verify URL matches `/admin/brands/<slug>` and the page shows the brand name from the suggestion

Update server.ts to seed:
- 1 brand (for the existing tier-override + assessment tests)
- 1 pending suggestion (for the accept-flow test)

Final verification:

```bash
bun run typecheck && bun run lint && bun run arch && bun run format && bun run test && bun run test:e2e
```

All must pass.

Commit: `test: E2E for suggestion accept flow + seed update`.

### Task 8: README + phase-4-complete tag

**Files:**
- Update: `README.md` (integrate brand-discovery into the existing sections; no phase labels per the established convention)
- Tag: annotated `phase-4-complete`

Update areas:

1. **"What it does"** — add to the elevator: "...with passive brand discovery via Reddit so new brands surface in an editorial queue rather than requiring you to find them manually."

2. **"How it works"** — add a new subsection between "Author assessments" and "Adaptive cadence learning" titled **"Brand discovery via Reddit"**:

> A weekly cron polls a curated set of running-focused subreddits (configured in `src/domain/suggestions/subreddits.ts`) via Reddit's per-subreddit RSS feeds — no authenticated API access required. For each post, Claude Haiku 4.5 extracts any running-apparel brand names mentioned, with a `plus_size_signal` flag set when the brand is mentioned in size-inclusivity context. Candidates are deduped against the existing brand index and prior pending suggestions; new ones land in `brand_suggestions` with the source subreddit, post URL, context excerpt, and priority flag.
>
> The admin "Suggestions" page lists pending candidates with plus-size-priority items at the top. One click — providing the brand's primary URL — promotes a suggestion into a real `brands` row via `BrandSuggestionService.accept`, all in one transaction. Rejected suggestions are kept (with a reason) so the same brand doesn't keep getting re-proposed.

3. **"Service surface" → "Admin UI"** — add the `/admin/suggestions` page to the page list.

4. **"Operations" → cron schedule table** — add:

| `sweep-reddit-suggestions` | Weekly Mondays @ 07:00 UTC |

5. **"External services"** — add Reddit RSS to the list (no API key, no cost, generous rate limits with a polite User-Agent).

Tag:

```bash
git tag -a phase-4-complete -m "Phase 4: Reddit brand-discovery + suggestion queue"
```

---

## Self-Review

After all 8 tasks:

- [ ] Migration `drizzle/0004_brand_suggestions.sql` exists with meaningful name
- [ ] `BrandSuggestionService.accept` is tx-wrapped; failure rolls back both brand insert and suggestion status update
- [ ] dep-cruiser: `src/admin-ui/actions/suggestion.ts` does NOT import schema tables
- [ ] `MONITORED_SUBREDDITS` is in ONE file; editing the list doesn't require touching ingestion logic
- [ ] All Anthropic costs go through `estimateAnthropicCost(MODEL_HAIKU)` — no inline arithmetic
- [ ] Cron registered in `src/main.ts`
- [ ] User-Agent on Reddit fetches is identifiable (per Reddit's API courtesy norms)
- [ ] E2E covers the accept flow
- [ ] README reads as comprehensive (no phase labels)
- [ ] Tag `phase-4-complete` set

## Spec coverage check

| Scope item (reduced) | Tasks |
|---|---|
| `brand_suggestions` table + admin queue | 1, 2, 6 |
| Reddit RSS ingestion + Claude-Haiku extraction | 3, 4, 5 |
| Plus-size priority flag | 1, 4, 6 |
| Scheduled cron | 5 |
| ~~Seed importers~~ | **SKIPPED** (manual entry) |

## Execution choice

Plan complete. Same options as prior phases:

1. **Subagent-Driven (recommended)** — bundle by group, run gates between
2. **Inline Execution** — via `superpowers:executing-plans`

**Branch strategy:** new worktree on `phase-4` from `main` (phases 1-3 are merged).
