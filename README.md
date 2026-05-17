# brand-scan

Authoritative service for running-apparel brand data — extraction, scoring, editorial assessments.

See `docs/superpowers/specs/2026-05-16-brand-scan-design.md` for full design.

## Local dev

    bun install
    cp .env.example .env
    bun run db:migrate
    bun run seed
    bun run dev

App at http://localhost:3000.

## Quality gates

    bun run typecheck
    bun run lint
    bun run arch
    bun run test
    bun run test:e2e

## Deployment (Dokploy on Hetzner)

1. Create a Dokploy app pointed at this GitHub repo, branch `main`.
2. Configure these env vars in the Dokploy app:
   - `ANTHROPIC_API_KEY`
   - `FIRECRAWL_API_KEY`
   - `PUSHOVER_USER_KEY`, `PUSHOVER_APP_TOKEN`
   - `BLOG_API_TOKEN` — bearer for the public API. Use `openssl rand -hex 16` once and share with the blog config.
   - `ADMIN_PASSWORD_HASH` — generate locally with `bun run set-admin-password <password>` and paste the printed line.
   - `SESSION_SECRET` — `openssl rand -hex 32`
   - `DATABASE_PATH=/data/brand-scan.sqlite`
   - `ARTIFACTS_PATH=/data/artifacts`
   - `PUBLIC_BASE_URL=https://brand-scan.<your-domain>`
   - `FIRECRAWL_MONTHLY_PAGE_BUDGET=1000`
   - `ANTHROPIC_MONTHLY_USD_BUDGET=10`
   - `NODE_ENV=production`
3. Mount a persistent volume at `/data`.
4. Configure Dokploy's volume backup to your Cloudflare R2 target.
5. Push to `main` — Dokploy auto-deploys.

## Architecture

See the design spec: `docs/superpowers/specs/2026-05-16-brand-scan-design.md`.

Phase 1 plan: `docs/superpowers/plans/2026-05-16-brand-scan-phase-1.md`.

## Phase 2 (catalogs + tier-aware scoring)

The brand-scan service now tracks per-brand product catalogs and computes tier-aware inclusivity scores.

### What phase 2 adds

- **Catalog discovery:** Shopify-first (`/products.json`), sitemap fallback. Discovered items land in `brand_items` with first-seen/last-verified timestamps.
- **Catalog change detection:** items not present in a refresh are marked `is_discontinued`; new items log an `added` event.
- **Tier classification:** price-percentile heuristic + AI refinement gate (`ENABLE_AI_TIER_REFINE=1` to enable AI). Human overrides via admin UI override the auto-classification.
- **Three new scoring dimensions** complete the inclusivity composite:
  - `range_parity` — category parity + tier parity (the "do bigger runners get flagship gear" measure)
  - `pricing_equity` — same-item price comparison across standard vs extended sizes
  - `colorway_equity` — colorway overlap across standard vs extended sizes
- **Public API:** `GET /api/v1/brands/:slug/items` for the blog to render catalog views
- **Adaptive cadence:** the `compute-brand-cadence` job sets `brands.predicted_next_change_at` based on observed change intervals

### New cron schedules

- `sweep-all-brand-catalogs` — monthly, 1st @ 04:00 UTC
- `classify-item-tiers-daily` — daily @ 06:00 UTC
- `compute-brand-cadence` — weekly Mondays @ 05:00 UTC

### Optional env vars

- `ENABLE_AI_TIER_REFINE=1` — enable Claude Haiku tier refinement after the price-percentile heuristic. Adds ~$0.001 per item classified. Default off.

## Module boundaries

Enforced by `dependency-cruiser` (run `bun run arch`):

- `src/domain/extraction` and `src/domain/scoring` do not import each other.
- `src/public-api` and `src/admin-ui` are leaf modules (only the composition root imports them).
- `src/infrastructure/*` is only imported from `src/domain` or `src/main.ts`.
- No deep imports across module boundaries — only `index.ts` barrels.
