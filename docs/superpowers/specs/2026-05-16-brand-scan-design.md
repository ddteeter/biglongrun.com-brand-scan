# brand-scan: Design Specification

**Date:** 2026-05-16
**Status:** Approved for implementation planning
**Origin:** [biglongrun.com#280](https://github.com/ddteeter/biglongrun.com/issues/280) — extracted from sister Astro blog repo into a standalone service

---

## 1. Overview

**brand-scan** is a standalone TypeScript/Bun service that builds, maintains, and exposes a canonical dataset about running apparel brands — with a particular focus on **size inclusivity** and **range parity** (do extended sizes get the same flagship gear as standard sizes?).

It runs as a separate service from the [biglongrun.com](https://biglongrun.com) Astro blog. The blog consumes brand data from brand-scan's HTTP API at build time. brand-scan is the **authoritative source** for all brand-level data (objective size charts, item catalogs, computed scores, and author subjective ratings + prose). The blog retains only product-level reviews and editorial content.

**Deployment:** Dokploy on a Hetzner box, single container, SQLite on a mounted volume, backups to Cloudflare R2 via Dokploy's built-in backup mechanism.

---

## 2. Goals & Non-Goals

### Goals

- Periodically extract and version brand size charts and product catalogs from public brand websites.
- Compute deterministic, reproducible scores across five inclusivity dimensions, relative to a peer cohort of running-focused brands.
- Capture human (editorial) brand-level assessments — both structured ratings (five dimensions) and free-form prose.
- Use an AI-assisted, human-in-the-loop pipeline with a learning correction log to minimize ongoing human involvement over time.
- Expose a stable, versioned, read-only JSON API for the blog (and only the blog) to consume.
- Maintain full audit history of brand evolution so changes over time are visible and queryable.
- Keep operational cost trivially small (Firecrawl free tier, Claude < $10/month).

### Non-Goals

- Multi-tenancy / multiple editorial teams. Single-user, single-editor by design.
- Real-time alerts to runners about brand changes (it's an editorial tool, not a consumer notification service).
- Public API for third-party consumers in v1.
- Brand discovery from Instagram/TikTok (out of vision scope).
- Modifications to the biglongrun.com blog itself (deferred to a follow-up project in that repo).

---

## 3. High-Level Architecture

**One Bun process. One SQLite file. One container on Dokploy.**

```
┌──────────────────────────────────────────────────────────────────┐
│                       brand-scan (one Bun process)               │
│                                                                  │
│  ┌───────────────────┐    ┌───────────────────┐                  │
│  │   Public HTTP API │    │     Admin UI      │                  │
│  │  (bearer-token,   │    │  (single-password │                  │
│  │   read-only,      │    │   session, JSX +  │                  │
│  │   for the blog)   │    │   HTMX, Pico)     │                  │
│  └─────────┬─────────┘    └─────────┬─────────┘                  │
│            │                        │                            │
│            └────────────┬───────────┘                            │
│                         │  Elysia routes + middleware            │
│  ┌──────────────────────┴───────────────────────────────────┐    │
│  │                 Domain modules (TS)                      │    │
│  │                                                          │    │
│  │  brands · extraction · scoring · catalog · assessments   │    │
│  │  cohorts · suggestions · notifications · usage           │    │
│  └──────────────────────────────┬───────────────────────────┘    │
│                                 │                                │
│  ┌──────────────────────────────┴────────────┐    ┌──────────┐   │
│  │           SQLite-backed job queue         │◄───┤ Bun.cron │   │
│  │   (push via EventEmitter, poll fallback)  │    └──────────┘   │
│  └──────────────────────────────┬────────────┘                   │
│                                 │                                │
│  ┌──────────────────────────────┴────────────────────────────┐   │
│  │                Drizzle ORM + bun:sqlite                   │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│   External:  Firecrawl · Anthropic (Sonnet 4.6 / Haiku 4.5)      │
│              · Pushover                                          │
└──────────────────────────────────────────────────────────────────┘
```

### Architectural commitments

- **Single process.** Simplifies SQLite (no multi-writer concerns), Dokploy (one container), deployment. Revisit only if HTTP latency degrades from background work — it won't at this scale.
- **The job queue is the only async boundary.** Anything slow gets a job. HTTP requests stay fast.
- **Module boundaries are enforced by `dependency-cruiser`** (see Quality Gates). Agents working in this codebase cannot quietly violate module boundaries.
- **Every step except the LLM call is deterministic and re-runnable.** Stored raw artifacts allow reprocessing with an improved prompt without re-paying external APIs.

---

## 4. Stack & Key Decisions

| Concern | Choice | Rationale |
|---|---|---|
| Runtime | **Bun** (latest 1.x) | Native TypeScript, `bun:sqlite` is the best SQLite story, fast startup, native cron. |
| HTTP framework | **Elysia** | Bun-native, end-to-end type safety via Eden, ergonomic plugin system. |
| Templates | **Server-rendered JSX** | No client bundle, no hydration. |
| Interactivity | **HTMX** | Editorial workflows are forms + tables; HTMX's request/swap model fits perfectly with ~5% of the complexity of a SPA. |
| Database | **SQLite** via `bun:sqlite` | Built-in to Bun, no native compilation, WAL mode, fast. Single-host appropriate for this scale. |
| ORM | **Drizzle** | Type-safe queries, schema-in-TS, migrations via `drizzle-kit`. |
| Styling | **Pico.css** | Classless defaults handle 90% of admin UI styling; minimal overrides. |
| Auth | Single password → `Bun.password` hash + signed session cookie | Single-user; no users table needed. |
| Notifications | **Pushover** | User already has an account; simple HTTP POST. |
| Validation | **Zod** | Drives Drizzle schema → validator parity; runtime validation at API boundaries. |
| Fetcher (paid) | **Firecrawl** | Handles JS rendering, anti-bot, screenshots. Free tier (1000 pages/month) covers our volume. |
| Extraction LLM | **Anthropic Claude Sonnet 4.6** | Best price/quality balance for structured extraction with vision. |
| Diff/classification LLM | **Anthropic Claude Haiku 4.5** | Cheap for trivial classification (e.g., email signal classification, tier inference). |
| Logging | **Pino** → stdout → Dokploy | Structured JSON; no external APM needed. |
| Backups | **Dokploy's built-in volume backup → Cloudflare R2** | Already configured by user. |

### Decisions explicitly rejected (with reasons)

- **Postgres** — overkill at this scale; SQLite operations are dead simple by comparison.
- **Two processes (API + worker)** — multi-writer SQLite concerns and added Dokploy complexity outweigh the (marginal) benefit at our volume.
- **Hono** over Elysia — Hono is more portable, but Elysia's Bun-nativeness and Eden type safety better fit a single-platform deployment.
- **Astro for the admin UI** — Astro shines for sparse-interactivity content sites; the editorial admin is the opposite shape.
- **Tailwind** — overkill for a single-user tool; Pico handles it.
- **ASTM D5585/D6960 as the reference standard** — paid documents (~$50–100); we use a cohort-derived reference instead (more honest for our domain anyway).
- **Litestream sidecar for backup** — Dokploy already manages volume backups to R2.
- **OpenTelemetry / Sentry / external APM** — overkill; in-DB run history + Pino + Pushover cover our needs.
- **GitHub Actions → image registry → Dokploy pull** — Dokploy's git deploy with CI on PRs is simpler.
- **Ongoing git-pull ingestion of the blog repo** — once brand-scan is authoritative, the only need is a one-shot backfill (CLI tool); no recurring blog reads.

---

## 5. Domain Model & Schema

Tables grouped by purpose. Full DDL belongs to the Drizzle schema files in the implementation plan; the shapes below are normative.

### 5.1 Brand identity & sources

```
brands
  id                              primary key
  slug                            immutable, auto-from-name with conflict suffix
  name
  primary_url                     canonical brand URL
  category_tag                    default 'running'
  audience_tags                   string[] for future cohort slicing
  current_size_chart_version_id   FK → brand_size_chart_versions.id, nullable
  divergence_flag                 boolean: computed vs author score gap > threshold
  predicted_next_change_at        nullable, set by adaptive cadence learning
  cadence_learned_at              nullable
  observed_change_intervals       JSON array of past change intervals
  active                          boolean (false = excluded from sweeps)
  created_at, updated_at, archived_at

brand_sources
  id                              primary key
  brand_id                        FK → brands.id
  url                             absolute URL to a page we extract from
  source_type                     'size_chart' | 'catalog_root' | 'shopify_feed'
  cadence_seconds_override        nullable (overrides default cadence)
  last_etag                       nullable, from previous response
  last_modified_header            nullable, from previous response
  last_fetch_hash                 sha256 of body, backstop for ETag-rotating CDNs
  last_fetched_at, last_changed_at
```

### 5.2 Size chart versioning (audit trail of evolution)

```
brand_size_chart_versions
  id                              primary key
  brand_id                        FK
  brand_source_id                 FK
  extracted_at
  source_run_id                   FK → runs.id (provenance)
  size_chart_json                 normalized canonical shape (see 5.7)
  confidence_score                composite, 0.0–1.0
  confidence_breakdown_json       { claude_reported, structural_validation, cohort_outlier }
  status                          'pending_review' | 'accepted' | 'rejected' | 'superseded'
  accepted_at, accepted_by        'auto' | 'human:<author_slug>'
  rejection_reason                nullable, required when status = 'rejected'
  supersedes_version_id           FK → self, nullable
  delta_from_prior_json           per-field diff vs. prior accepted version
```

A new row inserts only when `size_chart_json` differs from the prior accepted version — no churn for identical extractions. When a version transitions to `accepted`, the prior `accepted` row for the same brand transitions to `superseded`.

### 5.3 Item catalog (phase 2)

```
brand_items
  id                              primary key
  brand_id                        FK
  external_id                     e.g., Shopify product handle
  source_url
  name
  category                        free-form tag (tops, bottoms, shorts, etc.)
  tier_classification             'flagship' | 'mid' | 'basic' | 'unclassified'
  tier_inferred_by                'price_percentile' | 'ai' | 'human:<author>'
  tier_rationale                  AI's one-line note or human override note
  base_price_usd
  per_size_data_json              { 'XS': {available, price, colors[]}, ... }
  first_seen_at, last_verified_at
  is_discontinued, discontinued_at

brand_item_changes
  id                              primary key
  item_id                         FK → brand_items.id
  changed_at
  change_type                     'size_added' | 'tier_reclassified' | 'discontinued' | 'price_changed'
  before_json, after_json
  source_run_id                   FK → runs.id
```

Items are not heavily versioned (the user's insight: items rarely change post-launch). Catalog-level monitoring focuses on item additions/discontinuations; per-item edits go to the append-only `brand_item_changes` log for the rare cases.

### 5.4 Author assessments (canonical for brand-level opinion)

```
author_brand_assessments
  id                              primary key
  brand_id                        FK
  author_slug                     hardcoded single-user value in env, but field exists for future
  assessment_date
  ratings_json                    { size_options, tier_equity, pricing_equity,
                                    fit_label_honesty, overall_inclusivity }
                                  -- all five 0-10 floats, fixed in code
  prose_markdown
  origin                          'native' | 'backfilled_from_blog_review'
  source_review_url               nullable, populated for backfilled rows
  created_at, updated_at
```

The five rating dimensions are **fixed in code** (not configurable per brand), to enable cross-brand comparison.

### 5.5 Scoring (two-pass: aggregate cohort, then score)

```
cohort_summaries
  id                              primary key
  computed_at
  scoring_config_version          string from code, e.g., "v1.0"
  brand_count                     number of brands in this cohort
  summary_json                    aggregate medians, percentiles per dimension
  trigger                         'scheduled' | 'manual' | 'data_threshold'

brand_score_history
  id                              primary key
  brand_id                        FK
  computed_at
  scoring_config_version          string
  cohort_summary_id               FK → cohort_summaries.id
  scores_json                     { size_range_breadth, measurement_accuracy,
                                    range_parity, pricing_equity,
                                    colorway_equity, composite }
  inputs_json                     { size_chart_version_id, item_snapshot_ref }

brand_score_snapshots
  id                              primary key
  brand_id                        FK
  snapshot_at
  promoted_from_history_id        FK → brand_score_history.id
  cohort_summary_id               FK
  scores_json
  is_public                       false during early indexing (cohort < min_size)
```

`brand_score_history` records every computation. `brand_score_snapshots` is the public-facing smoothed timeline, promoted only when a score moves ≥ N points AND holds for M consecutive computations (configurable in code).

### 5.6 Discovery (phase 4)

```
brand_suggestions
  id                              primary key
  suggested_brand_name
  suggested_url
  source                          'reddit' | 'running_warehouse' | 'rei' | 'fleet_feet' | ...
  source_context_json             raw context (post excerpt, retailer record)
  suggested_at
  status                          'pending' | 'accepted' | 'rejected'
  resolved_at, resolved_brand_id, resolution_note
```

### 5.7 Operations

```
jobs
  id                              primary key
  job_type                        string (registered handler)
  payload_json
  dedupe_key                      unique; prevents double-scheduling
  status                          'pending' | 'running' | 'succeeded' | 'failed' | 'failed_dead'
  attempts, max_attempts
  scheduled_for
  picked_at
  heartbeat_at                    running job updates every ~30s
  heartbeat_interval_secs
  finished_at
  error_json
  run_id                          FK → runs.id, nullable until execution

runs
  id                              primary key
  job_id                          FK → jobs.id
  started_at, finished_at
  status
  summary_json                    job-type-specific summary (counts, links)
  cost_usd_estimate
  firecrawl_pages_used

run_artifacts
  id                              primary key
  run_id                          FK
  kind                            'screenshot' | 'raw_html' | 'raw_claude_response'
  file_path                       relative to /data/artifacts/
  bytes, sha256
  created_at

api_usage_log
  id                              primary key
  provider                        'firecrawl' | 'anthropic' | 'pushover'
  run_id                          FK, nullable
  units_used                      number
  units_kind                      'pages' | 'input_tokens' | 'output_tokens' | 'messages'
  estimated_cost_usd
  occurred_at

admin_sessions
  id                              primary key
  session_token                   hashed
  created_at, expires_at, last_seen_at
```

### 5.8 Canonical size chart JSON shape

```jsonc
{
  "source_url": "https://example.com/size-chart",
  "extracted_at": "2026-05-16T12:34:56Z",
  "method": "deterministic" | "claude",
  "size_labels": ["XS", "S", "M", "L", "XL", "XXL"],
  "measurements": {
    "XS":  { "chest_in": [31, 33], "waist_in": [23, 25], "hip_in": [33, 35] },
    "S":   { ... },
    ...
  },
  "size_availability": [
    { "category": "shorts", "available_sizes": ["XS", "S", "M", "L", "XL"] },
    { "category": "tops",   "available_sizes": ["XS", "S", "M", "L", "XL", "XXL"] }
  ],
  "notes": "Free-form notes captured by extractor",
  "gender_specific": false | "men" | "women" | "unisex"
}
```

Validators enforce: monotonically-increasing measurements across size labels, plausible value ranges (waist 20–60 in), required fields present, internal consistency (e.g., chest > waist for adult body measurements).

---

## 6. Extraction Pipeline

End-to-end flow for a single source URL.

### 6.1 Entry: `extract-brand-source` job

```
1. RATE GATE
   Per-domain rate limiter: 1 req / 30 sec / host.
   If too soon, reschedule job at appropriate time.

2. CHEAP CHANGE-DETECTION
   GET via plain bun fetch with conditional headers:
     If-None-Match: <last_etag>
     If-Modified-Since: <last_modified_header>

   Response 304 Not Modified
     → Update last_fetched_at. Exit. No further work, no cost.

   Response 200 OK
     → Store new ETag + Last-Modified
     → SHA-256 the body
     → Compare to last_fetch_hash (CDN-truth backstop)
     → If unchanged AND last accepted version is recent → exit
     → Otherwise → update last_fetch_hash, continue

3. RENDER (paid)
   Call Firecrawl: { url, formats: ['markdown', 'screenshot'] }.
   Persist screenshot to /data/artifacts/<run_id>.png.
   Log api_usage_log row.

4. PRIOR-CONTEXT ASSEMBLY
   Gather:
     - This brand's last accepted size_chart_version_json
     - Author brand assessments for this brand (5 ratings + prose)
     - Prior corrections for this brand (from version diff log)
     - The canonical normalized size chart shape (target output spec)

5. EXTRACTION (tiered)
   5a. Try deterministic parser on Firecrawl markdown/HTML:
       - Markdown-table parser → normalized JSON
       - If high-quality AND structurally valid → record confidence,
         flag method='deterministic', proceed to step 6.
   5b. Otherwise fall back to Claude (Sonnet 4.6):
       - Prior context (step 4) included in prompt as calibration anchors
       - Inputs: rendered markdown + screenshot
       - Output: structured JSON + per-field self-reported confidence + overall
         confidence + a short "what I saw" note for human reviewers
       - Token usage → api_usage_log
       - Flag method='claude'

6. STRUCTURAL VALIDATION (deterministic)
   Validators:
     - Measurements monotonically increase across size labels
     - Values within plausible human ranges
     - Required fields present
     - Internal consistency
   Produce structural_validation score (0.0–1.0).

7. COHORT OUTLIER CHECK (deterministic)
   Compare extracted values to current cohort_summary.
   Compute outlier_factor (1.0 = normal, < 1.0 reduces confidence).
   Extreme outliers (> 3 stddev on multiple dimensions) significantly reduce
   confidence.

8. COMPOSITE CONFIDENCE
   composite = claude_reported × structural_validation × outlier_factor
   Persist on version row with breakdown JSON.

9. DELTA VS PRIOR ACCEPTED VERSION
   If extracted JSON byte-identical to last accepted → drop, no version row.
   Else compute per-field delta JSON.

10. ROUTING
    composite ≥ 0.85 AND delta small
        → status='accepted', auto-promote, update brands.current_size_chart_version_id
    composite ≥ 0.85 AND delta large
        → status='pending_review', Pushover ("size chart materially changed: <brand>")
    0.40 ≤ composite < 0.85
        → status='pending_review', Pushover ("low-confidence extraction: <brand>")
    composite < 0.40
        → status='pending_review', flagged 'low_confidence', escalated Pushover wording

11. POST-ACCEPT TRIGGERS
    If newly accepted: enqueue score-brand job using current cohort_summary.
    No score recomputation inline.
```

### 6.2 Version state machine

```
                  ┌─────────────────────────┐
                  │       (just created)     │
                  └────────────┬─────────────┘
                               │
            composite ≥ 0.85 & delta small
                               ├──────────────► accepted
                               │
            needs human        │                  ▼ (admin clicks "approve")
                               ├──────► pending_review ──► accepted
                               │            │
                               │            ├──► rejected (admin: reason required)
                               │            │
                               │            └──► (admin edits JSON inline) ──► accepted
                               │
            byte-identical to prior
                               └──► (dropped, no row)

   When any version → accepted: prior accepted → superseded.
```

### 6.3 Extraction job types

| Job | When triggered | What it does |
|---|---|---|
| `extract-brand-source` | Cron sweep or manual admin trigger | One source URL → version row (above flow) |
| `detect-brand-source-changes` | Cron, all active brands | Runs cheap-first check per source; enqueues `extract-brand-source` only if changed |
| `sweep-all-brand-sources` | Monthly cron | Enqueues `detect-brand-source-changes` per active brand |
| `compute-brand-cadence` | Weekly cron, phase 2 | Computes `predicted_next_change_at` per brand from change history |
| `discover-brand-catalog` | Monthly cron, phase 2 | Shopify-first / sitemap fallback per brand |
| `recompute-cohort-summary` | Weekly cron or after N new accepted versions | Rebuilds `cohort_summaries`, enqueues `score-brand` for affected brands |
| `score-brand` | After new accepted version, or new cohort summary | Computes scores, appends `brand_score_history`, runs snapshot promotion |
| `detect-stuck-jobs` | Every minute | Resets `running` jobs with stale heartbeats |
| `backfill-blog-assessments` | Manual CLI invocation only (one-shot) | Parses blog repo path, inserts historical sizeOptions into author_brand_assessments |

### 6.4 Error handling

- Firecrawl 4xx/5xx → exponential backoff retry (cap 1 hour) per `attempts`; after `max_attempts` → `failed_dead`, Pushover.
- Claude error / timeout → retry per backoff policy; after max → `failed_dead`, Pushover.
- Schema validation failure on Claude output → no retry (deterministic failure); create version row with low confidence so it lands in `pending_review`.
- Per-domain rate-limit triggered during sweep → reschedule individual jobs with appropriate delays; the sweep itself never blocks.

### 6.5 Retention of run artifacts

- **Screenshots:** stored as files in `/data/artifacts/<run_id>.png`, referenced from `run_artifacts`.
- `pending_review` versions: indefinite retention (needed for admin review).
- `accepted` versions: most recent 5 per source retained.
- `superseded` versions: deleted after 30 days.
- A daily cleanup job enforces these.

### 6.6 Re-extraction with improved prompts

Because raw Firecrawl outputs (markdown + screenshot) are preserved in `run_artifacts`, a future `reprocess-version` job can rerun extraction against stored inputs without re-paying Firecrawl. Useful when the prompt improves materially.

---

## 7. Scoring Engine

### 7.1 Five dimensions

| Dimension | What it measures | Phase |
|---|---|---|
| `size_range_breadth` | Smallest → largest size label offered, normalized against the cohort breadth distribution | 1 |
| `measurement_accuracy` | Mean absolute deviation of brand measurements from cohort median per size label, normalized | 1 |
| `range_parity` | Two sub-scores averaged: **category parity** (extended sizes across all categories) + **tier parity** (extended sizes in flagship items, not just basics) | 2 |
| `pricing_equity` | Brand's max-size price multiple vs. cohort baseline | 2 |
| `colorway_equity` | Brand's colorway count ratio (extended : standard) vs. cohort baseline | 2 |

All five are computed **deterministically** from stored inputs. AI is in the extraction layer only.

### 7.2 Two-pass architecture

```
PASS 1: recompute-cohort-summary  (weekly OR on-demand when N new accepted versions land)
  Read all brands with current_size_chart_version_id set.
  Aggregate per size label:
    median + interquartile range of chest/waist/hip
  Aggregate distribution of breadth values.
  Aggregate tier/pricing/colorway baselines (phase 2).
  Persist new cohort_summaries row, tagged with scoring_config_version.

PASS 2: score-brand  (triggered: new accepted version OR new cohort summary)
  Inputs: brand's current size_chart_version, latest items, latest cohort_summary.
  Compute per-dimension scores deterministically (each 0–10).
  composite = (Σ weight_i × score_i) / (Σ weight_i)  -- normalized weighted average
            -- denominator includes only weights with non-null scores
            -- this keeps composite on a 0–10 scale regardless of which
            -- dimensions are active (clean phase 1 → phase 2 transition)
  Append brand_score_history row.
  Run snapshot promotion check.
```

### 7.3 Snapshot promotion

```
Trigger: each new brand_score_history row.
Inputs: last 3 history rows + last snapshot for this brand.

Promote a new snapshot if any of:
  - First snapshot for this brand AND cohort_summary.brand_count ≥ MIN_COHORT_SIZE_FOR_PUBLIC
  - abs(current - last_snapshot_composite) ≥ SNAPSHOT_PROMOTION_DELTA
    AND last 3 history rows move in same direction (sustained shift)
  - > 90 days since last snapshot (heartbeat: "still confirmed at this score")

is_public = (cohort_summary.brand_count ≥ MIN_COHORT_SIZE_FOR_PUBLIC)
```

### 7.4 Calibration loop

```
After scoring, compare:
  computed_composite  vs  mean(author_brand_assessments.ratings.overall_inclusivity)

If divergence > 2.0 points:
  → Flag brand with brands.divergence_flag = true
  → Admin UI surfaces these in dashboard
  → No Pushover (editorial-priority signal, not urgent)
```

### 7.5 Scoring config versioning

```typescript
// src/domain/scoring/config.ts
export const SCORING_CONFIG_VERSION = "v1.0";
export const WEIGHTS = {
  size_range_breadth: 0.25,
  measurement_accuracy: 0.20,
  range_parity: 0.30,      // 0.00 in phase 1
  pricing_equity: 0.15,    // 0.00 in phase 1
  colorway_equity: 0.10,   // 0.00 in phase 1
};
export const SNAPSHOT_PROMOTION_DELTA = 0.5;
export const MIN_COHORT_SIZE_FOR_PUBLIC = 5;
export const DIVERGENCE_FLAG_THRESHOLD = 2.0;
```

Bumping `SCORING_CONFIG_VERSION` triggers a `scoring_config_changed` job that recomputes cohort summary then re-scores all brands. History accumulates with the new version tag, allowing "before vs. after" comparison.

**Phase 1 composite:** because three of five dimensions require item data (phase 2), phase 1 scores `size_range_breadth` + `measurement_accuracy` only. Their dimension-level scores are null in `brand_score_history.scores_json` until phase 2; the composite formula's normalized-weighted-average automatically keeps composite on a 0–10 scale by dropping null-scored dimensions from both numerator and denominator. No special-casing required when phase 2 ships.

---

## 8. Admin UI

Server-rendered JSX + HTMX + Pico. Single-user, single-password session.

### 8.1 Pages

**`/admin/login`** — single password field, `Bun.password.verify`, HTTP-only signed session cookie.

**`/admin`** (dashboard) — at-a-glance card grid:
- Brands tracked (N), brands with current size chart (M), brands stale > 90 days (K)
- **Pending review queue size** (prominent, link)
- Recent runs (last 10, with status pills)
- Cost usage this month (Firecrawl pages / budget; Claude $ / budget)
- Recently divergent brands

**`/admin/brands`** — sortable filterable table: name, category, score, last_change, next_predicted_change, cadence. "Add brand" modal: name + primary URL → creates brand + first BrandSource → enqueues first extraction.

**`/admin/brands/:slug`** — header with name/URL/category/scores/divergence flag. HTMX-loaded tabs:
- **Overview** — current scores, cohort context, last update
- **Sources** — list of BrandSources; add/edit/delete; per-source cadence override
- **Size chart** — current accepted size chart + version history timeline; click a version to view full JSON + screenshot
- **Items** (phase 2) — catalog table with tier classification, size availability heatmap
- **Assessments** — list of author assessments with edit/add; markdown editor + 5 rating sliders
- **Score history** — sparkline of composite + per-dimension; jump-to-version on click
- **Runs** — recent extraction runs for this brand with status + artifact links

**`/admin/queue`** — the heart of editorial workflow. Filter by low-confidence / large-delta / both. Per-item two-column layout:
- Left: screenshot from Firecrawl (+ "View rendered HTML" link)
- Right: extracted JSON in an editor (CodeMirror or `<textarea>` + monospace)
- Below: cohort reference values per size (e.g., "this brand says XL waist=32" vs "cohort median XL waist=35")
- Buttons: **Approve as-is** / **Save edits + Approve** / **Reject** (reason required) / **Reprocess** (re-run extraction on stored artifacts)
- Keyboard shortcuts via HTMX: `a` approve, `r` reject, `j/k` next/prev
- After action: load next item inline, counter updates

**`/admin/assessments`** — global overview of all author brand assessments.

**`/admin/cohort`** — current cohort summary, when computed, brand count. "Recompute now" enqueues `recompute-cohort-summary`. Per-size median table, breadth distribution chart.

**`/admin/jobs`** — job queue table (pending, running with heartbeat age, recent finished, dead-lettered). Run history filter by brand / job_type / status. Retry for dead-lettered.

**`/admin/usage`** — monthly burn-down: Firecrawl pages used vs budget, Claude $ used vs budget. Daily chart. Per-provider per-job-type breakdown.

**`/admin/settings`** — rotate password (verify current → set new), default cadences (env-overridable but settable at runtime), read-only scoring config display.

### 8.2 HTMX patterns

- `hx-post` + `hx-target` for in-place updates
- `hx-trigger="keyup changed delay:300ms"` for markdown live preview (server-rendered)
- `hx-confirm` on destructive actions
- `hx-boost` on internal nav for snappier feel without a SPA

### 8.3 What we deliberately don't build

- Any heavy client-side state, client routing, or bundler for the admin UI.
- Any markdown rendering library on the client — server renders the preview.
- Any auth beyond a single password.

---

## 9. Public API

**Base path:** `/api/v1`. Breaking changes go to `/api/v2`.

**Auth:** `Authorization: Bearer <BLOG_API_TOKEN>` on every request except `/health`.

### 9.1 Endpoints

```
GET  /api/v1/health
     Public, no auth. Returns DB ping + job queue depth + uptime.

GET  /api/v1/brands?category=running&page=1
     List brands (paginated). Slim records (slug, name, category,
     composite score, last_update).

GET  /api/v1/brands/:slug
     Full brand record + current scores + assessments summary.

GET  /api/v1/brands/:slug/size-chart
     Current accepted size chart (normalized canonical shape).

GET  /api/v1/brands/:slug/score-history?since=YYYY-MM-DD
     Public-promoted score snapshots over time (smoothed).
     Always filters to snapshots with is_public = true.

GET  /api/v1/brands/:slug/items?category=tops
     Catalog with tier classification + size availability (phase 2).

GET  /api/v1/brands/:slug/assessments
     Author brand-level prose + ratings.

GET  /api/v1/scores/cohort-summary
     Latest cohort summary for relative-context display on the blog.
```

### 9.2 Response shapes

TypeScript-typed via Elysia's schema validation. Zod schemas drive both the validators and the documented response shapes.

### 9.3 Caching

- `Cache-Control: public, max-age=300` (5 min) default.
- `ETag` (sha256 of body) on every response; blog can use `If-None-Match` for free 304s.
- `Last-Modified` tied to the underlying row's `updated_at`.

### 9.4 Errors

RFC 9457 Problem Details JSON, same shape for all endpoints.

### 9.5 Rate limiting

In-memory token bucket per bearer token. Default ~100 req/min. Over-limit returns `429`. No bypass.

---

## 10. Operations

### 10.1 Deployment

- **GitHub repo** with `main` branch protected.
- **PR CI:** `bun typecheck` + `bun test` + `bun run lint` + `bun run arch` (dependency-cruiser).
- **Merge to `main`** triggers Dokploy webhook → Docker build → container swap.
- **Health check** on `/api/v1/health` confirms responsiveness before Dokploy promotes the new container.

### 10.2 Container

- Base: `oven/bun:1-alpine`
- Single process: `bun src/main.ts` boots Elysia + scheduler + worker loop.
- Volume mount: `/data` → SQLite DB + `/data/artifacts` for screenshots.
- Port: 3000 (Traefik fronts).
- Migrations: `drizzle-kit migrate` runs on boot before HTTP server starts. Failed migration = process exits non-zero = Dokploy rolls back.

### 10.3 Environment variables

```
ANTHROPIC_API_KEY        # Claude
FIRECRAWL_API_KEY        # Extraction fetcher
PUSHOVER_USER_KEY        # Notifications
PUSHOVER_APP_TOKEN       # Notifications
BLOG_API_TOKEN           # Bearer token the blog uses
ADMIN_PASSWORD_HASH      # Bcrypt hash of admin password (Bun.password.hash)
SESSION_SECRET           # Cookie signing key (32+ random bytes)
DATABASE_PATH            # /data/brand-scan.sqlite
PUBLIC_BASE_URL          # https://brand-scan.<your-domain>
NODE_ENV                 # production
```

### 10.4 Cost guardrails

```
FIRECRAWL_MONTHLY_PAGE_BUDGET = 1000   # current free tier ceiling
ANTHROPIC_MONTHLY_USD_BUDGET = 10      # Anthropic console cap is the hard ceiling
```

Layered protection:
1. `api_usage_log` tracking row written on every external call.
2. **Soft alert at 75% of budget** → Pushover.
3. **Hard circuit breaker at 100%** → jobs that would hit capped provider get postponed (return to `pending` with next-month `scheduled_for`). Read API stays up.
4. **Per-job sanity ceilings** — no single job makes more than N Firecrawl calls or M Claude calls; over → fail-fast and flag.

### 10.5 Backups

Managed entirely by Dokploy's built-in volume backup to Cloudflare R2 (already configured by user). No code in our service handles backups.

### 10.6 Observability

- **Pino structured logs** → stdout → Dokploy aggregation. Sensitive values (tokens, passwords) declared as explicit redact targets.
- **In-DB run history** (`runs`, `api_usage_log`) — admin UI is our metrics dashboard.
- **Pushover alerts** on: pending review items, budget thresholds (75% warn / 100% break), dead-lettered jobs, failed health checks (Dokploy probes).
- **No external APM / metrics service** in v1.

### 10.7 Local development

- `bun install && bun run dev` boots the same `src/main.ts` with `BUN_ENV=development`.
- DB path defaults to `./tmp/brand-scan.sqlite` (gitignored).
- Seed script: `bun run seed` loads ~5 sample brands + fake cohort summary.
- External services (Firecrawl, Claude, Pushover) replaced with local stubs unless `USE_REAL_APIS=1`.

---

## 11. Quality Gates & Testing Strategy

### 11.1 Quality gates (enforced in CI + locally via Husky pre-commit)

- `bun run typecheck` — strict TS, no `any` leakage
- `bun run lint` — ESLint flat config from `scaffold-typescript-project`
- `bun run test` — Bun test runner (unit + integration; in-memory SQLite)
- `bun run arch` — **dependency-cruiser** enforcing module boundaries
- `bun run format` — Prettier check
- `lint-staged` runs the above on staged files
- `jscpd` pre-commit catches copy-paste

### 11.2 Module boundary rules (dependency-cruiser config)

```
- src/public-api/**       importable only by src/server/**
- src/admin-ui/**         importable only by src/server/**
- src/domain/**           cannot import from public-api or admin-ui
- src/domain/extraction/  cannot import from src/domain/scoring/
- src/domain/scoring/     cannot import from src/domain/catalog/
                          (scoring reads cached cohort_summaries + brand data only)
- src/infrastructure/**   (db, queue, external clients) imported only by domain
- No circular imports anywhere
- No deep imports across module boundaries (only barrel files / index.ts)
```

### 11.3 Testing levels

| Level | Tool | Coverage |
|---|---|---|
| **Unit** | `bun test` | Pure functions: scoring math, validators, parsers, slug generation, confidence composition |
| **Integration** | `bun test` + in-memory `bun:sqlite` + mocked external clients | Domain modules end-to-end: extraction pipeline against fake Firecrawl/Claude, scoring against seeded DB, HTTP API routes via Elysia's test client |
| **End-to-end UI** | **Playwright** | Critical admin workflows in a real browser |

**E2E flows (capped intentionally):**
1. Login → dashboard renders
2. Add a brand → first extraction job appears in queue
3. Queue: approve item → next item loads, DB row status transitions
4. Queue: edit JSON → save → DB reflects edit
5. Author assessment: create → save → appears on brand page
6. Markdown editor: live preview updates on input

**CI placement:**
- PR CI: typecheck, lint, dependency-cruiser, unit + integration. < 2 min, blocks merge.
- Post-merge / pre-deploy CI: above + Playwright E2E. ~10 min total. Runs after merge to `main`, before Dokploy promotion.

**Test fixtures:**
- `tests/fixtures/firecrawl-responses/` — realistic Firecrawl response samples (markdown + screenshot PNGs) for ~5 representative brands.
- `tests/fixtures/claude-responses/` — canonical extracted JSON for those samples.
- Integration tests replay these against real extraction code; E2E uses a stubbed API server returning these.
- **All tests run fully offline** — no external API hits in CI ever.

---

## 12. Phases & Roadmap

### Phase 1 — Foundation + size-chart pipeline

End-to-end MVP: a brand can be added by hand, scraped, extracted, scored on two dimensions, exposed via API.

- Project scaffold (Bun + Elysia + JSX + HTMX + Drizzle + bun:sqlite + Pico)
- Dockerfile + Dokploy deployment
- Auth (single password) + admin UI shell
- Brand CRUD (manual entry only)
- BrandSource CRUD
- Job queue + Bun.cron scheduler + heartbeat + stuck-job detection
- Firecrawl integration + cheap-first hash/ETag change detection
- Claude size chart extraction (Sonnet 4.6) + version tracking
- Deterministic parser tier (tier 1 of extraction)
- Pending review queue + Pushover notifications
- Scoring engine: `size_range_breadth` + `measurement_accuracy` only (cohort-relative)
- Score history + snapshots tables (smoothing logic in place)
- Public API: `/brands`, `/brands/:slug`, `/brands/:slug/size-chart`, `/brands/:slug/score-history`
- Cost tracking + circuit breakers
- Pino logs + in-DB run history
- Module boundary enforcement (dependency-cruiser)
- Quality gates + Playwright E2E for 6 critical flows

### Phase 2 — Items catalog + tier-aware scoring

Full scoring online. The "do bigger runners get flagship gear?" question becomes answerable.

- Item discovery: Shopify-first (`/products.json`), sitemap fallback
- Item version tracking + catalog-level change detection (new/discontinued)
- Tier classification flow (price percentile + AI refinement + human override)
- Three remaining scoring dimensions: `range_parity` (category + tier sub-scores), `pricing_equity`, `colorway_equity`
- Public API: `/brands/:slug/items`
- Adaptive cadence learning (`compute-brand-cadence` job, `predicted_next_change_at`)

### Phase 3 — Author assessments + blog calibration

brand-scan becomes the canonical source of subjective brand opinion.

- Author brand assessments CRUD (5 fixed dimensions + markdown editor)
- One-shot CLI tool: `bun run backfill-blog-assessments --blog-repo <path>`
- Public API: `/brands/:slug/assessments`
- AI extraction prompt enriched with author assessments as calibration anchors
- Divergence flag in admin (objective score vs. author rating)

### Phase 4 — Seed + discovery automation

The brand index becomes self-feeding.

- Seed importers (one-shot): Running Warehouse, REI, Fleet Feet
- `brand_suggestions` table + "Suggested brands" admin queue
- Reddit RSS ingestion + Claude Haiku extraction → suggestions
  - Subreddits: r/RunningFashion, r/PlusSizeRunners, r/running, r/Ultramarathon, r/trailrunning
  - Plus-size-related suggestions get a `priority` flag

### Phase 5 — Polish (as-needed)

- Eden-typed client published as a private npm package for the blog
- Daily/weekly summary Pushover digest ("scraped N brands, M flagged, $X spent")
- Adaptive cadence refinements
- Anything surfaced during phase 1–4

---

## 13. Future Ideas (post-phase-5)

### Email-as-signal for change detection

**Concept:** invert polling. Subscribe brand-scan to brand newsletters; react when brands tell us new things exist.

**Implementation sketch:**
- Dedicated email address (e.g., `brand-scan-bot@<domain>`)
- Subscribe to brand newsletters from indexed brands
- Inbound email via Postmark or SendGrid Inbound Parse → webhook into brand-scan
- Claude Haiku classifies each email: `new_launch` / `restock` / `sale` / `unrelated`
- If `new_launch` or `restock` → enqueue an immediate sweep for that brand

**Why it's better than time-based polling:** brands signal launches deliberately. Cadence becomes event-driven and higher-signal.

**Pre-work needed:** brand → email-subscription mapping table; email parser; classification prompt; inbound webhook receiver.

---

## 14. Appendix A: Issue draft for email-as-signal

To file once the GitHub issue tracker is set up for this repo:

> **Title:** Add email-driven change detection for brand sweeps
>
> **Body:**
>
> Brands push new launches to their mailing lists. Currently we discover changes by periodic scraping; subscribing to brand newsletters would let us react when they tell us directly, dramatically improving signal-to-noise and reducing unnecessary Firecrawl pages.
>
> **Proposed implementation:**
> - Dedicated email address (`brand-scan-bot@<domain>`)
> - Subscribe to mailing lists for indexed brands; track subscription status in a `brand_email_subscriptions` table
> - Inbound email pipeline (Postmark Inbound Parse / SendGrid Inbound Parse / similar) posts emails to a webhook on brand-scan
> - Claude Haiku classifier: `new_launch` | `restock` | `sale` | `unrelated`
> - On `new_launch` or `restock` → enqueue immediate sweep for matched brand
>
> **Open questions:**
> - Email-receiving provider choice + cost
> - Brand-matching from email From: header (alias vs. canonical brand domain)
> - How to handle unsubscribe / list churn
> - Privacy/data-retention story for received emails
>
> **Dependencies:** none; this slots in as an additional source of sweep triggers without touching existing pipelines.

---

## 15. Decision Log (Summary)

Decisions made during brainstorming, with alternates considered and reasons rejected.

| Decision | Chosen | Rejected alternates |
|---|---|---|
| Service shape | One Bun process, SQLite-backed job queue, in-process worker | Two-process API+worker (overkill at scale); in-memory queue (loses jobs on restart) |
| Storage | SQLite via `bun:sqlite` on Dokploy volume | Postgres (overkill); flat YAML files in git (no relational data fit) |
| Data ownership | brand-scan canonical for ALL brand-level data (objective + subjective + prose) | Blog owns subjective ratings, brand-scan owns only objective (rejected because `sizeOptions` is a brand-level property miscategorized in blog reviews) |
| HTTP framework | Elysia (Bun-native, Eden type safety) | Hono (more portable but no Bun-specific benefits at our deployment shape); Astro (wrong shape for an editorial admin tool) |
| UI approach | Server-rendered JSX + HTMX | SPA (overkill); CLI-only (image review terrible in terminal); GitHub-issue-driven (side-by-side image+JSON review painful in GH) |
| Styling | Pico.css (minimal overrides) | Tailwind (overkill for single-user tool) |
| Extraction fetcher | Firecrawl (free tier) | Self-hosted Playwright (anti-bot fights + 300MB container bloat); tiered hand-rolled fetcher (premature) |
| Extraction LLM | Claude Sonnet 4.6 + (Haiku 4.5 for cheap diffs) | Firecrawl `/extract` endpoint (loses calibration context, pays same LLM tax through their margin) |
| Reference standard for scoring | Cohort-derived (peer brands) | ASTM D5585/D6960 (~$50–100 per standard, less honest for niche cohort anyway) |
| Brand discovery | Manual + 3 seed importers, Reddit phase 2 vision | Full IG/TikTok suite (out of scope) |
| Catalog discovery | Shopify-first, sitemap fallback | Universal category-page crawling (brittle); AI-guided walker (drifts on redesigns) |
| Item versioning | `brand_items` (current state) + `brand_item_changes` (append-only log) | Full item versioning (heavy; items rarely change post-launch) |
| Score timeline | `brand_score_history` (every) + `brand_score_snapshots` (smoothed) | Single table (creates churn on noise) |
| Backups | Dokploy-managed → Cloudflare R2 | Litestream sidecar (Dokploy already handles this); local volume only (no DR) |
| Deployment | Dokploy git deploy with PR CI gating | Image-registry-pull (more pieces, no benefit); manual CLI deploy (friction) |
| Blog integration | One-shot CLI for sizeOptions backfill; no ongoing pull | Ongoing git-pull-and-parse (unnecessary once brand-scan is authoritative) |
| Cadence | Monthly default, adaptive learning later | Daily (excessive); biweekly (still excessive for the actual change rate) |
| Robots.txt | Pragmatic + per-domain rate limiting | Strict enforcement (would block too many brands; we read like a human researcher) |
| Module enforcement | dependency-cruiser | ts-arch (more expressive but more code; dep-cruiser config is more agent-readable); eslint-plugin-boundaries (less expressive) |
| E2E testing | Playwright (real browser, 6 capped critical flows) | jsdom/happy-dom (HTMX needs real browser); no E2E (queue UX would silently regress) |
