# brand-scan

Authoritative service for running-apparel brand data — extraction, scoring, editorial assessments. Runs as a single Bun process on Dokploy, exposes a bearer-token-authenticated JSON API for the [biglongrun.com](https://biglongrun.com) blog to consume.

## What it does

brand-scan is the canonical source of truth for everything brand-level: objective size charts, item catalogs, computed inclusivity scores, and human editorial assessments. The blog renders brand pages by fetching from brand-scan's API; it stays a thin consumer.

The system periodically extracts brand data from public brand websites, scores brands across five inclusivity dimensions (cohort-relative), and routes low-confidence extractions through a single-user admin review queue. Cost is bounded — Firecrawl free tier + Claude < $10/month in steady state.

### Five scoring dimensions

| Dimension              | Measures                                                                                                                                                | Input                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `size_range_breadth`   | Where this brand falls in the cohort's distribution of "smallest → largest size offered"                                                                | Size chart                         |
| `measurement_accuracy` | How far this brand's measurements deviate from the cohort median per size label                                                                         | Size chart                         |
| `range_parity`         | Whether extended sizes are available across all categories AND in flagship items (not just basics) — the "do bigger runners get flagship gear?" measure | Item catalog + tier classification |
| `pricing_equity`       | Whether extended-size variants cost more than standard-size variants of the same item                                                                   | Item catalog (per-size prices)     |
| `colorway_equity`      | Whether the same colors are offered at extended sizes as at standard sizes                                                                              | Item catalog (per-size colors)     |

Composite score is a normalized weighted average — dimensions with `null` inputs (e.g., a brand with no items catalogued yet) drop out of both numerator and denominator, keeping the composite on a 0–10 scale.

## How it works

### Extraction pipeline

For each brand source URL (size chart page, Shopify `/products.json`, or sitemap):

1. **Cheap-first change detection.** Plain HTTP GET with `If-None-Match` / `If-Modified-Since` conditional headers, plus a sha256 body-hash backstop for CDNs that ETag-rotate on trivial changes. If unchanged → exit, no further cost.
2. **Render** (paid). Firecrawl handles JS rendering, anti-bot, and screenshot capture.
3. **Tiered extraction.** First try a deterministic markdown-table parser. If it produces a structurally valid chart with high confidence, skip Claude. Otherwise call Claude (Sonnet 4.6 for size charts, Haiku 4.5 for tier refinement) with prior-context: the brand's last accepted version, prior corrections, and author assessments serve as calibration anchors.
4. **Confidence gate.** Composite confidence = Claude's self-reported × structural validation × cohort-outlier check. High confidence + small delta auto-accepts; otherwise → admin review queue + Pushover notification.
5. **Version tracking.** Every accepted change creates a new immutable `brand_size_chart_versions` row. The brand's `current_size_chart_version_id` pointer moves forward; prior versions are marked `superseded`. Full audit history is queryable.

### Catalog discovery (per-brand product catalogs)

Two-tier strategy, both with conditional-fetch + body-hash skip-if-unchanged so steady-state runs cost nothing:

- **Shopify-first.** If the brand's `/products.json` endpoint responds and parses as Shopify, we use the full structured feed in one call. No per-item Firecrawl needed.
- **Sitemap fallback.** Parse `/sitemap.xml`, recursively follow sitemap indexes, filter for product URLs (`/products/`, `/p/`, `/shop/` patterns). For each new/changed product URL, render via Firecrawl + extract via Claude. Capped at 50 items/brand/run by default.

Items not seen in a refresh are marked `is_discontinued` with an audit-log entry. The catalog-level change summarizer surfaces deltas (new items, discontinued items, tier reclassifications, price changes) in admin views.

### Tier classification

Each item is classified into one of `flagship | mid | basic | unclassified`:

1. **Price-percentile heuristic** within the brand's own cohort (bottom 25% = basic, top 25% = flagship, middle 50% = mid). Requires ≥4 priced items.
2. **AI refinement** (optional, gated behind `ENABLE_AI_TIER_REFINE=1`) — Claude Haiku reads the product page and either confirms the heuristic or overrides it. Adds ~$0.001 per item.
3. **Human override** via the admin UI items tab. Marked `tier_inferred_by: 'human:<author>'` so subsequent runs skip the item.

### Author assessments

The editor records brand-level subjective ratings (5 fixed dimensions: `size_options`, `tier_equity`, `pricing_equity`, `fit_label_honesty`, `overall_inclusivity`) plus free-form prose markdown per brand via the admin UI. Assessments serve two purposes: (1) they're calibration anchors in the extraction prompt — Claude sees prior author ratings as a sanity check on its extracted size chart; (2) the scoring engine computes a divergence flag when the composite computed score diverges from the mean author `overall_inclusivity` by more than 2.0 points, surfacing brands where objective and subjective signals disagree.

Markdown is server-rendered via `marked` + `sanitize-html` — safe to expose via the public API.

### Adaptive cadence learning

Once a brand has ≥3 observed change intervals on its size chart, `compute-brand-cadence` learns the median + variance and sets `brands.predicted_next_change_at` when variance is low enough to make a reliable prediction. The scheduler can then prefer the predicted window over a flat cadence.

### Scoring (two-pass)

1. `recompute-cohort-summary` aggregates the current state of all brands into a single `cohort_summaries` row (per-size median + IQR of chest/waist/hip, breadth distribution).
2. `score-brand` computes per-dimension scores deterministically from the brand's current data + the latest cohort summary, appends to `brand_score_history`, and runs the snapshot-promotion check.

The public-facing score timeline (`brand_score_snapshots`) only promotes when a score moves ≥0.5 AND holds for 3 consecutive computations — prevents the timeline from churning on noise.

## Service surface

### Public HTTP API (bearer-token; for the blog)

```
GET  /api/v1/health
GET  /api/v1/brands                          # paginated list
GET  /api/v1/brands/:slug                    # full brand record + scores
GET  /api/v1/brands/:slug/size-chart         # current accepted size chart
GET  /api/v1/brands/:slug/score-history      # smoothed score timeline (is_public only)
GET  /api/v1/brands/:slug/items              # catalog with tier + per-size availability
GET  /api/v1/scores/cohort-summary           # cohort context for relative display
GET  /api/v1/brands/:slug/assessments        # author assessments with rendered+sanitized prose HTML
```

All responses set `ETag` and `Cache-Control: public, max-age=300`; the blog can use `If-None-Match` for free 304s during builds. Errors use RFC 9457 problem-details.

### Admin UI (single-password session; for the editor)

Server-rendered JSX + HTMX + Pico.css. Pages:

- **Dashboard** — at-a-glance counts, pending-review queue size, recent runs, cost burn-down
- **Brands list + add brand** — manual entry
- **Brand detail** — 7 tabs: overview (current scores + divergence flag), sources (URLs + extract-now), size chart (current + version history), score history (smoothed snapshots), runs (extraction runs for this brand), items (catalog with tier override form), assessments (author ratings + prose with live markdown preview)
- **Assessments** (`/admin/assessments`) — global list of all author assessments across brands, with links to per-brand edit views
- **Pending review queue** — two-column workflow: screenshot on the left, editable JSON on the right, ASTM-like cohort reference values below. Approve / save+approve / reject / reprocess actions; keyboard shortcuts via HTMX
- **Cohort** — current cohort summary + recompute trigger
- **Jobs / Runs / Usage / Settings**

## Operations

### Tech stack

- **Runtime:** Bun (`bun:sqlite` for the DB, native `Bun.password` for auth, native cron via `croner`)
- **HTTP:** Elysia
- **DB:** SQLite via `bun:sqlite` + `drizzle-orm` + `drizzle-kit` migrations
- **Validation:** Zod (drives both runtime validation and TypeScript types)
- **Logging:** Pino → stdout → Dokploy aggregation (with secret redaction)
- **Background work:** SQLite-backed job queue with EventTarget wakeup, heartbeat tracking, exponential-backoff retries, stuck-job detector

### External services

- **Firecrawl** — JS render + screenshot for size-chart pages and product pages (free tier, ~1000 pages/month)
- **Anthropic Claude** — Sonnet 4.6 for size-chart and item extraction; Haiku 4.5 for cheap classification (tier refinement, future email signal classification)
- **Pushover** — operator notifications: pending-review items, budget-threshold warnings, dead-lettered jobs

### Cost guardrails

Layered protection in the `domain/usage` module:

- Monthly budget caps in config (`FIRECRAWL_MONTHLY_PAGE_BUDGET=1000`, `ANTHROPIC_MONTHLY_USD_BUDGET=10`)
- Per-call usage tracked in `api_usage_log`
- 75% threshold → Pushover warning
- 100% → hard circuit breaker — jobs that would hit a capped provider get postponed; read API stays up
- Per-job sanity ceilings prevent any single job from spiraling

### Cron schedules

| Job                         | Cadence                                                |
| --------------------------- | ------------------------------------------------------ |
| `sweep-all-brand-sources`   | Monthly, 1st @ 03:00 UTC — size-chart change detection |
| `sweep-all-brand-catalogs`  | Monthly, 1st @ 04:00 UTC — catalog discovery           |
| `classify-item-tiers-daily` | Daily @ 06:00 UTC                                      |
| `compute-brand-cadence`     | Weekly Mondays @ 05:00 UTC                             |
| `recompute-cohort-summary`  | Weekly + on-demand when N new accepted versions land   |
| `detect-stuck-jobs`         | Every minute                                           |

## Local dev

```bash
bun install
cp .env.example .env       # fill in API keys + secrets
bun run db:migrate
bun run seed               # ~3 sample running brands
bun run dev                # http://localhost:3000
```

Admin UI: http://localhost:3000/admin (set `ADMIN_PASSWORD_HASH` via `bun run set-admin-password <password>` first).

## Quality gates

Every commit must pass:

```bash
bun run typecheck          # strict TypeScript, no any leakage
bun run lint               # ESLint flat config: type-checked + unicorn + sonarjs
bun run arch               # dependency-cruiser module boundaries
bun run format             # Prettier check
bun run test               # bun test (unit + integration, in-memory SQLite)
bun run test:e2e           # Playwright critical-flow tests
```

Husky pre-commit runs lint-staged + jscpd (copy-paste detection) + arch.

GitHub Actions runs the full suite (including Playwright) on every PR and again on push to `main`.

## Architecture

**Single Bun process** on a Dokploy container, **single SQLite file** on a mounted volume (backed up by Dokploy → Cloudflare R2). Inside the process: HTTP server (Elysia) + SQLite-backed job queue + cron scheduler, all in-process. No external Redis, no separate worker container, no APM.

**Domain modules** (`src/domain/<area>/`) encapsulate business logic and are arranged so each has one clear responsibility:

- `brands` — Brand + BrandSource + slug generation
- `extraction` — Size-chart extraction pipeline, versioning, prior-context assembly
- `catalog` — Item discovery (Shopify + sitemap), tier classification, change detection, cadence learning
- `scoring` — Cohort summary, per-dimension scoring, composite, snapshot promotion
- `usage` — API usage tracking + circuit breaker

**Infrastructure modules** (`src/infrastructure/<area>/`) provide platform glue (db, queue, HTTP, external clients, artifacts).

**Service pattern** — multi-step writes go through service classes (`BrandService`, `BrandItemService`, `VersionService`) that wrap operations in `db.transaction(...)`. Direct `db.select(...)` is fine for read-only display queries and operational tables. See [`CLAUDE.md`](./CLAUDE.md) for the precise convention and enforcement.

**Module boundaries** enforced by `dependency-cruiser`:

- `src/domain/extraction` and `src/domain/scoring` cannot import each other
- `src/domain/scoring` cannot import `src/domain/catalog`
- `src/public-api` and `src/admin-ui` are leaf modules (only the composition root imports them)
- `src/admin-ui/actions/**` cannot import schema tables — must call services (forces transactional integrity for writes)
- `src/infrastructure/*` only importable from `src/domain`, `src/jobs`, or the entry point
- No deep imports across module boundaries — only `index.ts` barrels

See [`CLAUDE.md`](./CLAUDE.md) for full conventions (transactional integrity, type derivation from schema, migration naming, prompt engineering, external pricing centralization).

## Deployment (Dokploy on Hetzner)

1. Create a Dokploy app pointed at this GitHub repo, branch `main`.
2. Configure env vars in the Dokploy app:
   - `ANTHROPIC_API_KEY`, `FIRECRAWL_API_KEY`
   - `PUSHOVER_USER_KEY`, `PUSHOVER_APP_TOKEN`
   - `BLOG_API_TOKEN` — bearer for the public API (`openssl rand -hex 16`, share with blog config)
   - `ADMIN_PASSWORD_HASH` — `bun run set-admin-password <password>` and paste the printed line
   - `SESSION_SECRET` — `openssl rand -hex 32`
   - `DATABASE_PATH=/data/brand-scan.sqlite`
   - `ARTIFACTS_PATH=/data/artifacts`
   - `PUBLIC_BASE_URL=https://brand-scan.<your-domain>`
   - `FIRECRAWL_MONTHLY_PAGE_BUDGET=1000`
   - `ANTHROPIC_MONTHLY_USD_BUDGET=10`
   - `NODE_ENV=production`
   - (optional) `ENABLE_AI_TIER_REFINE=1` to enable Claude Haiku tier refinement after the price-percentile heuristic (~$0.001/item)
3. Mount a persistent volume at `/data`.
4. Configure Dokploy's volume backup to your Cloudflare R2 target.
5. Push to `main` — Dokploy auto-deploys after CI passes.

## Further reading

- Design spec: [`docs/superpowers/specs/2026-05-16-brand-scan-design.md`](./docs/superpowers/specs/2026-05-16-brand-scan-design.md) — the full vision
- Agent conventions: [`CLAUDE.md`](./CLAUDE.md) — service pattern, transactions, schema-derived types, etc.
