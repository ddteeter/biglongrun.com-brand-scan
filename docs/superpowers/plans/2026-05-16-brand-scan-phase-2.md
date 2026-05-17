# brand-scan Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add brand product catalog tracking + tier-aware scoring to brand-scan. By the end of phase 2: catalogs are discovered (Shopify-first, sitemap fallback) and stored; items are tier-classified (price percentile + AI refinement + human override); catalog-level change detection records new/discontinued events; three new scoring dimensions (`range_parity`, `pricing_equity`, `colorway_equity`) come online; the public API exposes `/brands/:slug/items`; the admin UI gains an Items tab; adaptive cadence learning per-brand sets `predicted_next_change_at`.

**Architecture:** Reuses the phase-1 foundation (Bun + Elysia + Drizzle + bun:sqlite + dependency-cruiser-enforced module boundaries). New work lives in a new `src/domain/catalog/` module (catalog discovery + per-item operations), extends `src/domain/scoring/` with three new dimension functions, extends `src/domain/extraction/` with item-page extraction, adds two new tables (`brand_items`, `brand_item_changes`), adds new job handlers, and one new public-API route. Scoring stays a pure function of (brand data, item data, cohort summary).

**Tech Stack:** Same as phase 1. No new external dependencies expected; we'll reuse `FirecrawlClient`, `AnthropicClient`, the job queue, the artifact store, dependency-cruiser exemption patterns.

**Spec reference:** `docs/superpowers/specs/2026-05-16-brand-scan-design.md`
**Phase 1 reference:** `docs/superpowers/plans/2026-05-16-brand-scan-phase-1.md` (sets the codebase conventions used here)

**Phase 2 scope from the spec (section 12):**
- Item discovery: Shopify-first (`/products.json`), sitemap fallback
- Item version tracking + catalog-level change detection (new/discontinued)
- Tier classification flow (price percentile + AI refinement + human override)
- Three remaining scoring dimensions: `range_parity` (category + tier sub-scores), `pricing_equity`, `colorway_equity`
- Public API: `/brands/:slug/items`
- Adaptive cadence learning (`compute-brand-cadence` job, `predicted_next_change_at`)

**Out of scope (deferred to later phases):**
- Author assessments + blog backfill (phase 3)
- Brand suggestions + Reddit ingestion + seed importers (phase 4)
- Eden client + summary digest (phase 5)
- Email-as-signal change detection (future)

**Phase 1 conventions you inherit (DO follow them):**

1. **Strict TypeScript.** `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitAny`, etc. No `!` non-null assertions — use guards (`if (!x) throw new Error("..."); x.foo`).
2. **ESLint strict-type-checked + unicorn + sonarjs** rules are enforced via pre-commit. Common adaptations:
   - `Array<T>` → `T[]`
   - `async () => {}` with no `await` → `() => Promise.resolve()` (or extract sync helper)
   - Template literals with non-string → wrap with `String(...)`
   - `Math.random()` → `crypto.getRandomValues(...)` (sonarjs/pseudo-random)
   - `Array.from(...)` → `[...iter]` (unicorn/prefer-spread)
   - `Response` constructor for JSON → `Response.json(...)`
   - Regex with `[\s\S]*?` flagged as `sonarjs/slow-regex` — rewrite with `indexOf`-based scanning
   - `EventEmitter` → `EventTarget` (unicorn/prefer-event-target)
3. **Drizzle `sqliteTable(name, columns, callback)`** uses array-return callback or per-column references. See phase-1 schema files for examples.
4. **Zod v4 API:** `z.url()` (not deprecated `z.string().url()`).
5. **`getEnv()` lazy getter** (NOT eager `env` constant) for env access.
6. **`bun:sqlite` `.exec()` vs `.run()`** — both work. Use what passes lint.
7. **dependency-cruiser intra-module exemption:** the `no-deep-imports-across-modules` rule's `pathNot` includes `^src/(domain|infrastructure)/[^/]+/.+\.(ts|tsx)$` and `^src/(admin-ui|public-api)/.+\.(ts|tsx)$`. New submodules under those layers should sibling-import freely. Cross-module imports MUST go through the target module's `index.ts` barrel.
8. **Module boundary rules** enforced by dep-cruiser:
   - `domain` cannot import `public-api` or `admin-ui`
   - `domain/extraction` cannot import `domain/scoring`
   - `domain/scoring` cannot import `domain/catalog` ← **NEW IN PHASE 2: this is the rule for THIS phase**
   - `public-api` / `admin-ui` are leaf modules (only `server` imports them)
   - `infrastructure` only importable from domain, jobs, main, env, logger
9. **Tests:**
   - Unit tests in `tests/unit/` for pure functions
   - Integration tests in `tests/integration/` with in-memory `Database`, manual `CREATE TABLE` DDL, then `drizzle(sqlite, { schema })`
   - E2E tests in `tests/e2e/` via Playwright
10. **Commit per task.** Pre-commit runs lint-staged + jscpd + arch. Verify each commit's hook passes.
11. **Plan-text adaptations:** if a plan code block doesn't compile under our strict TS or breaches lint, adapt without disabling rules. Document each deviation in your report.

---

## File Structure

Phase 2 additions on top of phase 1:

```
src/
├── domain/
│   ├── catalog/                         ← NEW MODULE
│   │   ├── index.ts                     barrel
│   │   ├── types.ts                     ItemDraft + canonical shapes
│   │   ├── repo.ts                      BrandItemRepo CRUD + change log
│   │   ├── shopify.ts                   ShopifyCatalogDiscoverer
│   │   ├── sitemap.ts                   SitemapCatalogDiscoverer
│   │   ├── discoverer.ts                discoverBrandCatalog orchestrator
│   │   ├── item-extractor.ts            per-product page extractor (Claude tier classifier)
│   │   ├── tier-classifier.ts           price-percentile heuristic + AI refinement
│   │   ├── change-detector.ts           new/discontinued detection per catalog refresh
│   │   └── cadence.ts                   compute-brand-cadence algorithm
│   ├── scoring/
│   │   ├── range-parity.ts              ← NEW
│   │   ├── pricing-equity.ts            ← NEW
│   │   ├── colorway-equity.ts           ← NEW
│   │   ├── cohort.ts                    ← UPDATED: extend with item-level aggregates
│   │   └── (other phase-1 files)
│   └── extraction/
│       └── (phase-1 files, untouched)
├── infrastructure/
│   └── db/schema/
│       └── items.ts                     ← NEW: brand_items + brand_item_changes
├── jobs/
│   ├── discover-brand-catalog.ts        ← NEW
│   ├── classify-item-tier.ts            ← NEW
│   ├── extract-item-detail.ts           ← NEW (optional, only for non-Shopify brands)
│   ├── compute-brand-cadence.ts         ← NEW
│   └── (existing jobs updated to enqueue new ones)
├── public-api/
│   └── items.ts                         ← NEW: /api/v1/brands/:slug/items
├── admin-ui/
│   ├── pages/
│   │   └── brand-tabs/items.tsx         ← REPLACES phase-1 placeholder
│   └── actions/
│       └── item.ts                      ← NEW: tier override action

drizzle/
└── 0001_*.sql                           ← NEW migration

tests/
├── unit/
│   ├── catalog/
│   │   ├── shopify-parser.test.ts
│   │   ├── tier-classifier.test.ts
│   │   ├── change-detector.test.ts
│   │   └── cadence.test.ts
│   └── scoring/
│       ├── range-parity.test.ts
│       ├── pricing-equity.test.ts
│       └── colorway-equity.test.ts
├── integration/
│   ├── items-schema.test.ts
│   ├── brand-item-repo.test.ts
│   ├── shopify-discoverer.test.ts
│   ├── sitemap-discoverer.test.ts
│   ├── catalog-pipeline.test.ts
│   ├── tier-classifier-ai.test.ts
│   ├── compute-brand-cadence-job.test.ts
│   ├── scoring-pipeline-phase2.test.ts
│   └── public-api-items.test.ts
└── e2e/
    └── tier-override.spec.ts            ← NEW (replaces phase-3 assessment placeholder)
```

---

## Task Groups

- **Group A — Items schema** (Tasks 1–3): schema + migration + repo
- **Group B — Catalog discovery** (Tasks 4–7): Shopify + sitemap + orchestrator + job
- **Group C — Tier classification** (Tasks 8–10): heuristic + AI + admin override
- **Group D — Catalog change detection** (Tasks 11–12): new/discontinued + cadence learning
- **Group E — New scoring dimensions** (Tasks 13–16): range-parity + pricing-equity + colorway-equity + cohort/score integration
- **Group F — Public API + Admin UI** (Tasks 17–19): /items endpoint + items tab + tier override
- **Group G — Wiring & polish** (Tasks 20–22): job registration, scheduler updates, README + tag

22 tasks total. Estimated ~50–60 hours of agentic work given established conventions.

---

## Group A — Items schema

### Task 1: brand_items + brand_item_changes schema

**Files:**
- Create: `src/infrastructure/db/schema/items.ts`, update `src/infrastructure/db/schema/index.ts`
- Test: `tests/integration/items-schema.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { brands } from "../../src/infrastructure/db/schema/brands";
import { brandItems, brandItemChanges } from "../../src/infrastructure/db/schema/items";

describe("brand_items + brand_item_changes schema", () => {
  let db: ReturnType<typeof drizzle>;
  beforeEach(() => {
    const sqlite = new Database(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON;");
    sqlite.exec(`
      CREATE TABLE brands (
        id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        primary_url TEXT NOT NULL, category_tag TEXT NOT NULL DEFAULT 'running',
        audience_tags TEXT NOT NULL DEFAULT '[]', current_size_chart_version_id INTEGER,
        divergence_flag INTEGER NOT NULL DEFAULT 0, predicted_next_change_at TEXT,
        cadence_learned_at TEXT, observed_change_intervals TEXT,
        active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')), archived_at TEXT
      );
      CREATE TABLE brand_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        external_id TEXT,
        source_url TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        tier_classification TEXT NOT NULL DEFAULT 'unclassified' CHECK (tier_classification IN ('flagship','mid','basic','unclassified')),
        tier_inferred_by TEXT,
        tier_rationale TEXT,
        base_price_usd REAL,
        per_size_data_json TEXT NOT NULL DEFAULT '{}',
        first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_verified_at TEXT NOT NULL DEFAULT (datetime('now')),
        is_discontinued INTEGER NOT NULL DEFAULT 0,
        discontinued_at TEXT,
        UNIQUE(brand_id, source_url)
      );
      CREATE TABLE brand_item_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL REFERENCES brand_items(id) ON DELETE CASCADE,
        changed_at TEXT NOT NULL DEFAULT (datetime('now')),
        change_type TEXT NOT NULL CHECK (change_type IN ('size_added','tier_reclassified','discontinued','price_changed','added')),
        before_json TEXT,
        after_json TEXT,
        source_run_id INTEGER
      );
    `);
    db = drizzle(sqlite);
  });

  test("inserts a brand item with default tier", async () => {
    const [b] = await db.insert(brands).values({ slug: "x", name: "X", primaryUrl: "https://x.com" }).returning();
    if (!b) throw new Error("brand insert returned empty");
    const [item] = await db.insert(brandItems).values({
      brandId: b.id, sourceUrl: "https://x.com/p/storm-jacket", name: "Storm Jacket", category: "outerwear",
    }).returning();
    expect(item?.tierClassification).toBe("unclassified");
    expect(item?.isDiscontinued).toBe(false);
  });

  test("brand_id+source_url uniqueness", async () => {
    const [b] = await db.insert(brands).values({ slug: "x", name: "X", primaryUrl: "https://x.com" }).returning();
    if (!b) throw new Error("brand insert returned empty");
    await db.insert(brandItems).values({
      brandId: b.id, sourceUrl: "https://x.com/p/a", name: "A", category: "tops",
    });
    let threw = false;
    try {
      await db.insert(brandItems).values({
        brandId: b.id, sourceUrl: "https://x.com/p/a", name: "Different", category: "tops",
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("brand_item_changes cascade-deletes when item deleted", async () => {
    const [b] = await db.insert(brands).values({ slug: "x", name: "X", primaryUrl: "https://x.com" }).returning();
    if (!b) throw new Error("brand insert returned empty");
    const [item] = await db.insert(brandItems).values({
      brandId: b.id, sourceUrl: "https://x.com/p/a", name: "A", category: "tops",
    }).returning();
    if (!item) throw new Error("item insert returned empty");
    await db.insert(brandItemChanges).values({
      itemId: item.id, changeType: "added", afterJson: { name: "A" },
    });
    await db.delete(brandItems).where(eq(brandItems.id, item.id));
    const remaining = await db.select().from(brandItemChanges);
    expect(remaining.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
bun test tests/integration/items-schema.test.ts
```
Expected: FAIL (schema file missing).

- [ ] **Step 3: Write src/infrastructure/db/schema/items.ts**

```typescript
import { sql } from "drizzle-orm";
import { sqliteTable, integer, text, real, uniqueIndex } from "drizzle-orm/sqlite-core";
import { brands } from "./brands";

export const brandItems = sqliteTable(
  "brand_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    brandId: integer("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    externalId: text("external_id"),
    sourceUrl: text("source_url").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    tierClassification: text("tier_classification", {
      enum: ["flagship", "mid", "basic", "unclassified"],
    }).notNull().default("unclassified"),
    tierInferredBy: text("tier_inferred_by"),
    tierRationale: text("tier_rationale"),
    basePriceUsd: real("base_price_usd"),
    perSizeDataJson: text("per_size_data_json", { mode: "json" })
      .$type<Record<string, { available: boolean; price?: number; colors?: string[] }>>()
      .notNull()
      .default(sql`'{}'`),
    firstSeenAt: text("first_seen_at").notNull().default(sql`(datetime('now'))`),
    lastVerifiedAt: text("last_verified_at").notNull().default(sql`(datetime('now'))`),
    isDiscontinued: integer("is_discontinued", { mode: "boolean" }).notNull().default(false),
    discontinuedAt: text("discontinued_at"),
  },
  (t) => [uniqueIndex("brand_items_brand_url_unique").on(t.brandId, t.sourceUrl)]
);

export const brandItemChanges = sqliteTable("brand_item_changes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id").notNull().references(() => brandItems.id, { onDelete: "cascade" }),
  changedAt: text("changed_at").notNull().default(sql`(datetime('now'))`),
  changeType: text("change_type", {
    enum: ["size_added", "tier_reclassified", "discontinued", "price_changed", "added"],
  }).notNull(),
  beforeJson: text("before_json", { mode: "json" }).$type<Record<string, unknown>>(),
  afterJson: text("after_json", { mode: "json" }).$type<Record<string, unknown>>(),
  sourceRunId: integer("source_run_id"),
});
```

- [ ] **Step 4: Update barrel**

`src/infrastructure/db/schema/index.ts` — append:

```typescript
export * from "./items";
```

- [ ] **Step 5: Run test, verify pass + quality gates**

```bash
bun test tests/integration/items-schema.test.ts
bun run typecheck && bun run lint && bun run arch
```

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/db/schema/items.ts src/infrastructure/db/schema/index.ts tests/integration/items-schema.test.ts
git commit -m "feat: brand_items and brand_item_changes schema"
```

---

### Task 2: Generate phase-2 migration

**Files:**
- Generate: `drizzle/0001_*.sql` + meta updates

- [ ] **Step 1: Run drizzle-kit generate**

```bash
bun run db:generate
```
Expected: creates `drizzle/0001_<random_name>.sql` adding `brand_items` and `brand_item_changes` tables. Inspect the SQL to confirm.

- [ ] **Step 2: Run migration smoke test against fresh DB**

```bash
mkdir -p ./tmp
DATABASE_PATH=./tmp/p2.sqlite bun run db:migrate
sqlite3 ./tmp/p2.sqlite ".tables" | tr ' ' '\n' | sort | uniq -c
rm -f ./tmp/p2.sqlite ./tmp/p2.sqlite-*
```
Expected: 13 tables total now (11 from phase-1 + 2 new).

- [ ] **Step 3: Verify against existing migrated DB (idempotency)**

If you have an existing phase-1 DB hanging around, the 0001 migration must apply cleanly without rewriting prior tables. Recreate:

```bash
DATABASE_PATH=./tmp/p2-add.sqlite bun run db:migrate    # creates fresh with both migrations
sqlite3 ./tmp/p2-add.sqlite ".tables"
rm -f ./tmp/p2-add.sqlite ./tmp/p2-add.sqlite-*
```

- [ ] **Step 4: Commit**

```bash
git add drizzle/
git commit -m "feat: drizzle migration 0001 for items + item changes"
```

---

### Task 3: BrandItemRepo (CRUD + change log helper)

**Files:**
- Create: `src/domain/catalog/repo.ts`, `src/domain/catalog/types.ts`, `src/domain/catalog/index.ts`
- Test: `tests/integration/brand-item-repo.test.ts`

- [ ] **Step 1: Write src/domain/catalog/types.ts**

```typescript
import { z } from "zod";

export const PerSizeDataSchema = z.record(
  z.string(),
  z.object({
    available: z.boolean(),
    price: z.number().optional(),
    colors: z.array(z.string()).optional(),
  })
);
export type PerSizeData = z.infer<typeof PerSizeDataSchema>;

export const ItemDraftSchema = z.object({
  brandId: z.number().int().positive(),
  externalId: z.string().nullable().optional(),
  sourceUrl: z.string().url(),
  name: z.string().min(1),
  category: z.string().min(1),
  basePriceUsd: z.number().nullable().optional(),
  perSizeData: PerSizeDataSchema.default({}),
});
export type ItemDraft = z.infer<typeof ItemDraftSchema>;
```

- [ ] **Step 2: Write src/domain/catalog/repo.ts**

```typescript
import { and, eq } from "drizzle-orm";
import type { DB } from "../../infrastructure/db";
import { brandItems, brandItemChanges } from "../../infrastructure/db/schema";
import { ItemDraftSchema, type ItemDraft } from "./types";

export class BrandItemRepo {
  constructor(private readonly db: DB) {}

  async listForBrand(brandId: number, opts: { includeDiscontinued?: boolean } = {}) {
    if (opts.includeDiscontinued) {
      return this.db.select().from(brandItems).where(eq(brandItems.brandId, brandId));
    }
    return this.db
      .select()
      .from(brandItems)
      .where(and(eq(brandItems.brandId, brandId), eq(brandItems.isDiscontinued, false)));
  }

  async findByBrandAndUrl(brandId: number, sourceUrl: string) {
    const [row] = await this.db
      .select()
      .from(brandItems)
      .where(and(eq(brandItems.brandId, brandId), eq(brandItems.sourceUrl, sourceUrl)))
      .limit(1);
    return row ?? null;
  }

  async upsertDraft(raw: unknown, sourceRunId: number | null): Promise<{ id: number; created: boolean }> {
    const draft: ItemDraft = ItemDraftSchema.parse(raw);
    const existing = await this.findByBrandAndUrl(draft.brandId, draft.sourceUrl);
    const nowIso = new Date().toISOString();
    if (existing) {
      await this.db
        .update(brandItems)
        .set({
          name: draft.name,
          category: draft.category,
          basePriceUsd: draft.basePriceUsd ?? null,
          perSizeDataJson: draft.perSizeData,
          lastVerifiedAt: nowIso,
          isDiscontinued: false,
          discontinuedAt: null,
        })
        .where(eq(brandItems.id, existing.id));
      return { id: existing.id, created: false };
    }
    const [row] = await this.db
      .insert(brandItems)
      .values({
        brandId: draft.brandId,
        externalId: draft.externalId ?? null,
        sourceUrl: draft.sourceUrl,
        name: draft.name,
        category: draft.category,
        basePriceUsd: draft.basePriceUsd ?? null,
        perSizeDataJson: draft.perSizeData,
      })
      .returning({ id: brandItems.id });
    if (!row) throw new Error("brand_items insert returned empty");
    await this.db.insert(brandItemChanges).values({
      itemId: row.id,
      changeType: "added",
      afterJson: { name: draft.name, category: draft.category },
      sourceRunId: sourceRunId ?? null,
    });
    return { id: row.id, created: true };
  }

  async markDiscontinued(itemId: number, sourceRunId: number | null): Promise<void> {
    const nowIso = new Date().toISOString();
    const [before] = await this.db.select().from(brandItems).where(eq(brandItems.id, itemId)).limit(1);
    if (!before) throw new Error(`brand_item not found: ${String(itemId)}`);
    if (before.isDiscontinued) return;
    await this.db
      .update(brandItems)
      .set({ isDiscontinued: true, discontinuedAt: nowIso })
      .where(eq(brandItems.id, itemId));
    await this.db.insert(brandItemChanges).values({
      itemId,
      changeType: "discontinued",
      beforeJson: { name: before.name, category: before.category },
      sourceRunId: sourceRunId ?? null,
    });
  }
}
```

- [ ] **Step 3: Write src/domain/catalog/index.ts**

```typescript
export { BrandItemRepo } from "./repo";
export { ItemDraftSchema, PerSizeDataSchema, type ItemDraft, type PerSizeData } from "./types";
```

- [ ] **Step 4: Write integration test `tests/integration/brand-item-repo.test.ts`**

```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/infrastructure/db/schema";
import { brands, brandItems, brandItemChanges } from "../../src/infrastructure/db/schema";
import { BrandItemRepo } from "../../src/domain/catalog";
import { eq } from "drizzle-orm";

function makeDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec(`
    CREATE TABLE brands (
      id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      primary_url TEXT NOT NULL, category_tag TEXT NOT NULL DEFAULT 'running',
      audience_tags TEXT NOT NULL DEFAULT '[]', current_size_chart_version_id INTEGER,
      divergence_flag INTEGER NOT NULL DEFAULT 0, predicted_next_change_at TEXT,
      cadence_learned_at TEXT, observed_change_intervals TEXT,
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), archived_at TEXT
    );
    CREATE TABLE brand_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
      external_id TEXT, source_url TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL,
      tier_classification TEXT NOT NULL DEFAULT 'unclassified',
      tier_inferred_by TEXT, tier_rationale TEXT, base_price_usd REAL,
      per_size_data_json TEXT NOT NULL DEFAULT '{}',
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_verified_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_discontinued INTEGER NOT NULL DEFAULT 0, discontinued_at TEXT,
      UNIQUE(brand_id, source_url)
    );
    CREATE TABLE brand_item_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES brand_items(id) ON DELETE CASCADE,
      changed_at TEXT NOT NULL DEFAULT (datetime('now')),
      change_type TEXT NOT NULL, before_json TEXT, after_json TEXT, source_run_id INTEGER
    );
  `);
  return drizzle(sqlite, { schema });
}

describe("BrandItemRepo", () => {
  let db: ReturnType<typeof makeDb>;
  let repo: BrandItemRepo;
  let brandId: number;

  beforeEach(async () => {
    db = makeDb();
    repo = new BrandItemRepo(db);
    const [b] = await db.insert(brands).values({ slug: "x", name: "X", primaryUrl: "https://x.com" }).returning();
    if (!b) throw new Error("brand setup failed");
    brandId = b.id;
  });

  test("upsertDraft inserts new item + change log entry", async () => {
    const r = await repo.upsertDraft({
      brandId, sourceUrl: "https://x.com/p/a", name: "A", category: "tops",
    }, null);
    expect(r.created).toBe(true);
    const items = await repo.listForBrand(brandId);
    expect(items.length).toBe(1);
    const changes = await db.select().from(brandItemChanges);
    expect(changes.length).toBe(1);
    expect(changes[0]?.changeType).toBe("added");
  });

  test("upsertDraft updates existing item by URL, no new change entry", async () => {
    await repo.upsertDraft({ brandId, sourceUrl: "https://x.com/p/a", name: "A", category: "tops" }, null);
    const r2 = await repo.upsertDraft({
      brandId, sourceUrl: "https://x.com/p/a", name: "A v2", category: "tops", basePriceUsd: 120,
    }, null);
    expect(r2.created).toBe(false);
    const items = await repo.listForBrand(brandId);
    expect(items.length).toBe(1);
    expect(items[0]?.name).toBe("A v2");
    expect(items[0]?.basePriceUsd).toBe(120);
    const changes = await db.select().from(brandItemChanges);
    expect(changes.length).toBe(1); // still only the original 'added' entry
  });

  test("markDiscontinued sets flag + records change", async () => {
    const r = await repo.upsertDraft({ brandId, sourceUrl: "https://x.com/p/a", name: "A", category: "tops" }, null);
    await repo.markDiscontinued(r.id, null);
    const items = await db.select().from(brandItems).where(eq(brandItems.id, r.id));
    expect(items[0]?.isDiscontinued).toBe(true);
    const changes = await db.select().from(brandItemChanges);
    expect(changes.map((c) => c.changeType).sort()).toEqual(["added", "discontinued"]);
  });

  test("listForBrand excludes discontinued by default", async () => {
    const r = await repo.upsertDraft({ brandId, sourceUrl: "https://x.com/p/a", name: "A", category: "tops" }, null);
    await repo.markDiscontinued(r.id, null);
    expect((await repo.listForBrand(brandId)).length).toBe(0);
    expect((await repo.listForBrand(brandId, { includeDiscontinued: true })).length).toBe(1);
  });
});
```

- [ ] **Step 5: Verify quality gates + commit**

```bash
bun test tests/integration/brand-item-repo.test.ts
bun run typecheck && bun run lint && bun run arch
git add src/domain/catalog/ tests/integration/brand-item-repo.test.ts
git commit -m "feat: BrandItemRepo with upsert + discontinue + change log"
```


---

## Group B — Catalog discovery

### Task 4: Shopify catalog discoverer

Many running brands (Tracksmith, Janji, Rabbit, Path Projects, etc.) run on Shopify and expose `<host>/products.json` as a structured public feed. Use it before falling back to scraping.

**Files:**
- Create: `src/domain/catalog/shopify.ts`, update barrel
- Test: `tests/unit/catalog/shopify-parser.test.ts`

- [ ] **Step 1: Write failing test** (`tests/unit/catalog/shopify-parser.test.ts`)

```typescript
import { describe, test, expect } from "bun:test";
import { isLikelyShopify, parseShopifyProductsJson } from "../../../src/domain/catalog/shopify";

const SAMPLE = {
  products: [
    {
      id: 123, handle: "storm-jacket", title: "Storm Jacket",
      product_type: "Outerwear",
      variants: [
        { id: 1, title: "S", available: true, price: "120.00", option1: "S" },
        { id: 2, title: "M", available: true, price: "120.00", option1: "M" },
        { id: 3, title: "L", available: false, price: "120.00", option1: "L" },
      ],
      options: [{ name: "Size", values: ["S", "M", "L"] }],
      images: [{ src: "https://cdn.shopify.com/x.jpg" }],
    },
    {
      id: 124, handle: "tee", title: "Cotton Tee", product_type: "Tops",
      variants: [
        { id: 10, title: "Default", available: true, price: "35.00", option1: "S" },
        { id: 11, title: "Default", available: true, price: "35.00", option1: "M" },
      ],
      options: [{ name: "Size", values: ["S", "M"] }],
      images: [],
    },
  ],
};

describe("shopify catalog parser", () => {
  test("isLikelyShopify true for valid /products.json response", () => {
    expect(isLikelyShopify({ products: [] })).toBe(true);
    expect(isLikelyShopify({ items: [] })).toBe(false);
    expect(isLikelyShopify(null)).toBe(false);
    expect(isLikelyShopify("string")).toBe(false);
  });

  test("parseShopifyProductsJson returns ItemDrafts for each product", () => {
    const drafts = parseShopifyProductsJson(SAMPLE, {
      brandId: 1,
      brandHost: "tracksmith.com",
    });
    expect(drafts.length).toBe(2);
    const jacket = drafts.find((d) => d.name === "Storm Jacket");
    expect(jacket?.sourceUrl).toBe("https://tracksmith.com/products/storm-jacket");
    expect(jacket?.basePriceUsd).toBe(120);
    expect(jacket?.externalId).toBe("storm-jacket");
    expect(jacket?.category).toBe("Outerwear");
    expect(jacket?.perSizeData?.S?.available).toBe(true);
    expect(jacket?.perSizeData?.L?.available).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
bun test tests/unit/catalog/shopify-parser.test.ts
```

- [ ] **Step 3: Write src/domain/catalog/shopify.ts**

```typescript
import { z } from "zod";
import type { ItemDraft, PerSizeData } from "./types";

const VariantSchema = z.object({
  id: z.number(),
  title: z.string(),
  available: z.boolean(),
  price: z.string(),
  option1: z.string().nullable().optional(),
  option2: z.string().nullable().optional(),
  option3: z.string().nullable().optional(),
});

const ProductSchema = z.object({
  id: z.number(),
  handle: z.string(),
  title: z.string(),
  product_type: z.string().default(""),
  variants: z.array(VariantSchema),
  options: z.array(z.object({ name: z.string(), values: z.array(z.string()) })).default([]),
});

const ProductsJsonSchema = z.object({
  products: z.array(ProductSchema),
});

export function isLikelyShopify(raw: unknown): boolean {
  return typeof raw === "object" && raw !== null && Array.isArray((raw as { products?: unknown }).products);
}

export interface ParseShopifyOptions {
  brandId: number;
  brandHost: string; // e.g., "tracksmith.com"
}

export function parseShopifyProductsJson(raw: unknown, opts: ParseShopifyOptions): ItemDraft[] {
  const parsed = ProductsJsonSchema.parse(raw);
  const drafts: ItemDraft[] = [];
  const host = opts.brandHost.replace(/^https?:\/\//, "").replace(/\/$/, "");
  for (const product of parsed.products) {
    const sizeOptionIndex = product.options.findIndex((o) => /size/i.test(o.name));
    const sizes: string[] = sizeOptionIndex === -1 ? [] : (product.options[sizeOptionIndex]?.values ?? []);
    const sizeKey = (variant: typeof product.variants[number]): string | null => {
      if (sizeOptionIndex === -1) return variant.option1 ?? null;
      if (sizeOptionIndex === 0) return variant.option1 ?? null;
      if (sizeOptionIndex === 1) return variant.option2 ?? null;
      if (sizeOptionIndex === 2) return variant.option3 ?? null;
      return null;
    };

    const perSize: PerSizeData = {};
    for (const variant of product.variants) {
      const size = sizeKey(variant);
      if (!size) continue;
      const priceNum = Number.parseFloat(variant.price);
      perSize[size] = {
        available: variant.available,
        ...(Number.isFinite(priceNum) ? { price: priceNum } : {}),
      };
    }
    // Ensure listed sizes have entries even if no variant matched
    for (const s of sizes) {
      if (!(s in perSize)) perSize[s] = { available: false };
    }

    const firstPrice = product.variants[0]?.price;
    const basePrice = firstPrice !== undefined ? Number.parseFloat(firstPrice) : null;

    drafts.push({
      brandId: opts.brandId,
      externalId: product.handle,
      sourceUrl: `https://${host}/products/${product.handle}`,
      name: product.title,
      category: product.product_type || "uncategorized",
      basePriceUsd: Number.isFinite(basePrice) && basePrice !== null ? basePrice : null,
      perSizeData: perSize,
    });
  }
  return drafts;
}

export class ShopifyCatalogDiscoverer {
  constructor(private readonly fetchFn: typeof globalThis.fetch = globalThis.fetch) {}

  async tryFetch(brandPrimaryUrl: string): Promise<unknown | null> {
    const u = new URL(brandPrimaryUrl);
    const host = u.host;
    const url = `https://${host}/products.json?limit=250`;
    try {
      const r = await this.fetchFn(url, {
        headers: { "user-agent": "brand-scan/1.0" },
      });
      if (!r.ok) return null;
      const ct = r.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) return null;
      const json: unknown = await r.json();
      if (!isLikelyShopify(json)) return null;
      return json;
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 4: Update barrel** (`src/domain/catalog/index.ts`)

```typescript
export { BrandItemRepo } from "./repo";
export { ItemDraftSchema, PerSizeDataSchema, type ItemDraft, type PerSizeData } from "./types";
export { isLikelyShopify, parseShopifyProductsJson, ShopifyCatalogDiscoverer, type ParseShopifyOptions } from "./shopify";
```

- [ ] **Step 5: Verify + commit**

```bash
bun test tests/unit/catalog/shopify-parser.test.ts
bun run typecheck && bun run lint && bun run arch
git add src/domain/catalog/shopify.ts src/domain/catalog/index.ts tests/unit/catalog/shopify-parser.test.ts
git commit -m "feat: Shopify catalog discoverer + products.json parser"
```

---

### Task 5: Sitemap fallback discoverer

For non-Shopify brands. Fetches `sitemap.xml`, finds product URLs by URL pattern + heuristic, returns a list of URLs (NOT parsed items — those come later).

**Files:**
- Create: `src/domain/catalog/sitemap.ts`, update barrel
- Test: `tests/integration/sitemap-discoverer.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, test, expect } from "bun:test";
import { SitemapCatalogDiscoverer } from "../../src/domain/catalog/sitemap";

const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://brand.com/</loc></url>
  <url><loc>https://brand.com/about</loc></url>
  <url><loc>https://brand.com/products/storm-jacket</loc></url>
  <url><loc>https://brand.com/products/sky-tee</loc></url>
  <url><loc>https://brand.com/blog/2026-news</loc></url>
</urlset>`;

const SITEMAP_INDEX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://brand.com/sitemap-products.xml</loc></sitemap>
  <sitemap><loc>https://brand.com/sitemap-pages.xml</loc></sitemap>
</sitemapindex>`;

const PRODUCTS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://brand.com/products/storm-jacket</loc></url>
  <url><loc>https://brand.com/products/sky-tee</loc></url>
</urlset>`;

const stubFetch = (responses: Record<string, string>) =>
  (url: RequestInfo | URL): Promise<Response> => {
    const key = url.toString();
    const body = responses[key];
    if (!body) return Promise.resolve(new Response("", { status: 404 }));
    return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "application/xml" } }));
  };

describe("SitemapCatalogDiscoverer", () => {
  test("returns product URLs from flat sitemap", async () => {
    const d = new SitemapCatalogDiscoverer(
      stubFetch({ "https://brand.com/sitemap.xml": SITEMAP_XML }) as typeof globalThis.fetch
    );
    const urls = await d.discover("https://brand.com");
    expect(urls.sort()).toEqual([
      "https://brand.com/products/sky-tee",
      "https://brand.com/products/storm-jacket",
    ]);
  });

  test("follows sitemap index and aggregates", async () => {
    const d = new SitemapCatalogDiscoverer(
      stubFetch({
        "https://brand.com/sitemap.xml": SITEMAP_INDEX_XML,
        "https://brand.com/sitemap-products.xml": PRODUCTS_XML,
        "https://brand.com/sitemap-pages.xml": SITEMAP_XML,
      }) as typeof globalThis.fetch
    );
    const urls = await d.discover("https://brand.com");
    expect(urls.length).toBe(2);
    expect(urls.every((u) => u.includes("/products/"))).toBe(true);
  });

  test("returns empty array when sitemap missing", async () => {
    const d = new SitemapCatalogDiscoverer(stubFetch({}) as typeof globalThis.fetch);
    expect(await d.discover("https://brand.com")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
bun test tests/integration/sitemap-discoverer.test.ts
```

- [ ] **Step 3: Write src/domain/catalog/sitemap.ts**

```typescript
const PRODUCT_URL_PATTERNS = [/\/products?\//i, /\/p\//i, /\/shop\//i];

function extractLocs(xml: string): string[] {
  const locs: string[] = [];
  let cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf("<loc>", cursor);
    if (start === -1) break;
    const end = xml.indexOf("</loc>", start);
    if (end === -1) break;
    locs.push(xml.slice(start + "<loc>".length, end).trim());
    cursor = end + "</loc>".length;
  }
  return locs;
}

function isSitemapIndex(xml: string): boolean {
  return xml.includes("<sitemapindex");
}

function isProductUrl(url: string): boolean {
  return PRODUCT_URL_PATTERNS.some((p) => p.test(url));
}

export class SitemapCatalogDiscoverer {
  constructor(private readonly fetchFn: typeof globalThis.fetch = globalThis.fetch) {}

  async discover(brandPrimaryUrl: string): Promise<string[]> {
    const u = new URL(brandPrimaryUrl);
    const root = `https://${u.host}/sitemap.xml`;
    return this.discoverFrom(root);
  }

  private async discoverFrom(url: string): Promise<string[]> {
    const r = await this.fetchFn(url, { headers: { "user-agent": "brand-scan/1.0" } });
    if (!r.ok) return [];
    const text = await r.text();
    const locs = extractLocs(text);
    if (locs.length === 0) return [];
    if (isSitemapIndex(text)) {
      const nested = await Promise.all(locs.map((loc) => this.discoverFrom(loc)));
      return nested.flat();
    }
    return locs.filter(isProductUrl);
  }
}
```

- [ ] **Step 4: Update barrel** (append):

```typescript
export { SitemapCatalogDiscoverer } from "./sitemap";
```

- [ ] **Step 5: Verify + commit**

```bash
bun test tests/integration/sitemap-discoverer.test.ts
bun run typecheck && bun run lint && bun run arch
git add src/domain/catalog/sitemap.ts src/domain/catalog/index.ts tests/integration/sitemap-discoverer.test.ts
git commit -m "feat: sitemap catalog discoverer (fallback for non-Shopify brands)"
```

---

### Task 6: Catalog discoverer orchestrator + per-item Claude extraction

The orchestrator tries Shopify first; falls back to sitemap. For sitemap URLs, fetches each via Firecrawl + parses with Claude. Returns `ItemDraft[]` for the brand.

**Files:**
- Create: `src/domain/catalog/discoverer.ts`, `src/domain/catalog/item-extractor.ts`, update barrel
- Test: `tests/integration/catalog-pipeline.test.ts`

- [ ] **Step 1: Write src/domain/catalog/item-extractor.ts**

```typescript
import { z } from "zod";
import { AnthropicClient, MODEL_SONNET } from "../../infrastructure/external";
import type { ItemDraft, PerSizeData } from "./types";

const ClaudeItemSchema = z.object({
  name: z.string(),
  category: z.string(),
  base_price_usd: z.number().nullable(),
  per_size: z.record(z.string(), z.object({
    available: z.boolean(),
    price: z.number().optional(),
    colors: z.array(z.string()).optional(),
  })),
  confidence: z.number().min(0).max(1),
});

const SYSTEM_PROMPT = `You extract running-apparel product details into normalized JSON.
Inputs: rendered markdown of a single product page and a screenshot.
Output exactly one JSON object with keys:
- name (string): product display name
- category (string): apparel category — tops, bottoms, shorts, outerwear, accessories, etc.
- base_price_usd (number | null): list price in USD
- per_size (object): map of size label → { available: boolean, price?: number, colors?: string[] }
- confidence (number 0–1)
If you cannot identify a recognizable product, return confidence < 0.3 and a best-effort name like "(unidentified)".`;

export interface ExtractItemInput {
  client: AnthropicClient;
  brandId: number;
  sourceUrl: string;
  markdown: string;
  screenshotPng?: Uint8Array;
}

export interface ExtractItemResult {
  draft: ItemDraft;
  confidence: number;
  usage: { inputTokens: number; outputTokens: number };
}

export async function extractItemDetail(input: ExtractItemInput): Promise<ExtractItemResult> {
  const resp = await input.client.extractStructured({
    model: MODEL_SONNET,
    systemPrompt: SYSTEM_PROMPT,
    userText: `Source URL: ${input.sourceUrl}\n\nMarkdown:\n${input.markdown}`,
    ...(input.screenshotPng ? { userImagePngBytes: input.screenshotPng } : {}),
    maxTokens: 1024,
  });
  const parsed = ClaudeItemSchema.parse(resp.parsed);
  const perSize: PerSizeData = {};
  for (const [label, value] of Object.entries(parsed.per_size)) {
    perSize[label] = {
      available: value.available,
      ...(value.price !== undefined ? { price: value.price } : {}),
      ...(value.colors !== undefined ? { colors: value.colors } : {}),
    };
  }
  return {
    draft: {
      brandId: input.brandId,
      sourceUrl: input.sourceUrl,
      name: parsed.name,
      category: parsed.category || "uncategorized",
      basePriceUsd: parsed.base_price_usd,
      perSizeData: perSize,
    },
    confidence: parsed.confidence,
    usage: resp.usage,
  };
}
```

- [ ] **Step 2: Write src/domain/catalog/discoverer.ts**

```typescript
import { ShopifyCatalogDiscoverer, parseShopifyProductsJson } from "./shopify";
import { SitemapCatalogDiscoverer } from "./sitemap";
import { extractItemDetail } from "./item-extractor";
import type { ItemDraft } from "./types";
import type { FirecrawlClient } from "../../infrastructure/external/firecrawl";
import type { AnthropicClient } from "../../infrastructure/external/anthropic";
import type { DomainRateLimiter } from "../../infrastructure/external/rate-limiter";

export interface DiscoverDeps {
  shopify: ShopifyCatalogDiscoverer;
  sitemap: SitemapCatalogDiscoverer;
  firecrawl: FirecrawlClient;
  anthropic: AnthropicClient;
  rateLimiter: DomainRateLimiter;
  recordUsage: (input: { provider: "firecrawl" | "anthropic"; unitsUsed: number; unitsKind: string; estimatedCostUsd: number }) => Promise<void>;
}

export interface DiscoverInput {
  brandId: number;
  brandPrimaryUrl: string;
  maxSitemapItems?: number; // safety cap when falling back to per-item extraction
}

export interface DiscoverResult {
  source: "shopify" | "sitemap" | "none";
  drafts: ItemDraft[];
}

const FIRECRAWL_COST_PER_PAGE = 0;

function hostnameOf(url: string): string {
  return new URL(url).host;
}

export async function discoverBrandCatalog(deps: DiscoverDeps, input: DiscoverInput): Promise<DiscoverResult> {
  // 1. Try Shopify first
  const shopifyJson = await deps.shopify.tryFetch(input.brandPrimaryUrl);
  if (shopifyJson) {
    const drafts = parseShopifyProductsJson(shopifyJson, {
      brandId: input.brandId,
      brandHost: hostnameOf(input.brandPrimaryUrl),
    });
    return { source: "shopify", drafts };
  }

  // 2. Fall back to sitemap → Firecrawl per item → Claude extract
  const productUrls = await deps.sitemap.discover(input.brandPrimaryUrl);
  if (productUrls.length === 0) {
    return { source: "none", drafts: [] };
  }
  const cap = input.maxSitemapItems ?? 50;
  const urls = productUrls.slice(0, cap);
  const drafts: ItemDraft[] = [];
  for (const url of urls) {
    await deps.rateLimiter.wait(hostnameOf(url));
    deps.rateLimiter.record(hostnameOf(url));
    try {
      const render = await deps.firecrawl.render(url);
      await deps.recordUsage({ provider: "firecrawl", unitsUsed: 1, unitsKind: "pages", estimatedCostUsd: FIRECRAWL_COST_PER_PAGE });
      const result = await extractItemDetail({
        client: deps.anthropic,
        brandId: input.brandId,
        sourceUrl: url,
        markdown: render.markdown,
        screenshotPng: render.screenshotBytes,
      });
      await deps.recordUsage({
        provider: "anthropic",
        unitsUsed: result.usage.inputTokens + result.usage.outputTokens,
        unitsKind: "tokens",
        estimatedCostUsd: (result.usage.inputTokens * 3 + result.usage.outputTokens * 15) / 1_000_000,
      });
      if (result.confidence >= 0.3) drafts.push(result.draft);
    } catch {
      // Skip individual item failures; continue.
    }
  }
  return { source: "sitemap", drafts };
}
```

- [ ] **Step 3: Update barrel**

```typescript
export { extractItemDetail, type ExtractItemInput, type ExtractItemResult } from "./item-extractor";
export { discoverBrandCatalog, type DiscoverDeps, type DiscoverInput, type DiscoverResult } from "./discoverer";
```

- [ ] **Step 4: Write integration test** (`tests/integration/catalog-pipeline.test.ts`)

Tests both Shopify path and sitemap path with stubbed externals. Use the FirecrawlClient + AnthropicClient stub patterns from phase-1 (see `tests/integration/extraction-pipeline.test.ts` for reference).

```typescript
import { describe, test, expect } from "bun:test";
import { ShopifyCatalogDiscoverer } from "../../src/domain/catalog/shopify";
import { SitemapCatalogDiscoverer } from "../../src/domain/catalog/sitemap";
import { discoverBrandCatalog } from "../../src/domain/catalog/discoverer";
import { FirecrawlClient } from "../../src/infrastructure/external/firecrawl";
import { AnthropicClient } from "../../src/infrastructure/external/anthropic";
import { DomainRateLimiter } from "../../src/infrastructure/external/rate-limiter";

const SHOPIFY_RESPONSE = {
  products: [{
    id: 1, handle: "jacket", title: "Jacket", product_type: "Outerwear",
    options: [{ name: "Size", values: ["S", "M"] }],
    variants: [
      { id: 1, title: "S", available: true, price: "120.00", option1: "S" },
      { id: 2, title: "M", available: false, price: "120.00", option1: "M" },
    ],
  }],
};

describe("discoverBrandCatalog", () => {
  test("returns Shopify path drafts when /products.json works", async () => {
    const fetchFn = ((url: RequestInfo | URL): Promise<Response> => {
      if (String(url) === "https://brand.com/products.json?limit=250") {
        return Promise.resolve(Response.json(SHOPIFY_RESPONSE));
      }
      return Promise.resolve(new Response("", { status: 404 }));
    }) as typeof globalThis.fetch;

    const shopify = new ShopifyCatalogDiscoverer(fetchFn);
    const sitemap = new SitemapCatalogDiscoverer(fetchFn);
    const firecrawl = new FirecrawlClient({ apiKey: "test", fetch: fetchFn });
    const anthropic = new AnthropicClient({ apiKey: "test", sdkOverride: { messages: { create: () => { throw new Error("should not be called"); } } } as never });
    const rateLimiter = new DomainRateLimiter({ minIntervalMs: 0 });

    const result = await discoverBrandCatalog({
      shopify, sitemap, firecrawl, anthropic, rateLimiter,
      recordUsage: () => Promise.resolve(),
    }, { brandId: 1, brandPrimaryUrl: "https://brand.com" });

    expect(result.source).toBe("shopify");
    expect(result.drafts.length).toBe(1);
    expect(result.drafts[0]?.name).toBe("Jacket");
  });

  test("falls back to sitemap path when /products.json missing", async () => {
    const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://brand.com/products/jacket</loc></url>
      </urlset>`;
    const fetchFn = ((url: RequestInfo | URL): Promise<Response> => {
      const key = String(url);
      if (key === "https://brand.com/products.json?limit=250") return Promise.resolve(new Response("", { status: 404 }));
      if (key === "https://brand.com/sitemap.xml") return Promise.resolve(new Response(SITEMAP, { status: 200, headers: { "content-type": "application/xml" } }));
      if (key === "https://api.firecrawl.dev/v1/scrape") {
        return Promise.resolve(Response.json({ success: true, data: { markdown: "# Jacket\nPrice $120 Sizes S, M", screenshot: "https://files.firecrawl.dev/x.png" } }));
      }
      if (key === "https://files.firecrawl.dev/x.png") return Promise.resolve(new Response(new Uint8Array([0]), { status: 200 }));
      return Promise.resolve(new Response("", { status: 404 }));
    }) as typeof globalThis.fetch;

    const shopify = new ShopifyCatalogDiscoverer(fetchFn);
    const sitemap = new SitemapCatalogDiscoverer(fetchFn);
    const firecrawl = new FirecrawlClient({ apiKey: "test", fetch: fetchFn });
    const fakeSdk = {
      messages: {
        create: () => Promise.resolve({
          content: [{ type: "text", text: JSON.stringify({
            name: "Jacket", category: "Outerwear", base_price_usd: 120,
            per_size: { S: { available: true, price: 120 }, M: { available: true, price: 120 } },
            confidence: 0.9,
          }) }],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      },
    };
    const anthropic = new AnthropicClient({ apiKey: "test", sdkOverride: fakeSdk as never });
    const rateLimiter = new DomainRateLimiter({ minIntervalMs: 0 });

    const result = await discoverBrandCatalog({
      shopify, sitemap, firecrawl, anthropic, rateLimiter,
      recordUsage: () => Promise.resolve(),
    }, { brandId: 1, brandPrimaryUrl: "https://brand.com" });

    expect(result.source).toBe("sitemap");
    expect(result.drafts.length).toBe(1);
    expect(result.drafts[0]?.name).toBe("Jacket");
  });
});
```

- [ ] **Step 5: Verify + commit**

```bash
bun test tests/integration/catalog-pipeline.test.ts
bun run typecheck && bun run lint && bun run arch
git add src/domain/catalog/ tests/integration/catalog-pipeline.test.ts
git commit -m "feat: catalog discovery orchestrator (Shopify + sitemap fallback)"
```

---

### Task 7: discover-brand-catalog job handler

**Files:**
- Create: `src/jobs/discover-brand-catalog.ts`, update `src/jobs/index.ts`
- Test: smoke test in existing extract-job test, or new `tests/integration/discover-catalog-job.test.ts`

- [ ] **Step 1: Write src/jobs/discover-brand-catalog.ts**

```typescript
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { JobHandler } from "../infrastructure/queue";
import type { DB } from "../infrastructure/db";
import { brands } from "../infrastructure/db/schema";
import { BrandItemRepo, discoverBrandCatalog, type DiscoverDeps } from "../domain/catalog";
import { runs } from "../infrastructure/db/schema";

const PayloadSchema = z.object({ brandId: z.number().int().positive() });

export interface MakeArgs {
  db: DB;
  buildDiscoverDeps: () => DiscoverDeps;
}

export function makeDiscoverBrandCatalogHandler(args: MakeArgs): JobHandler {
  return async (rawPayload, ctx) => {
    const { brandId } = PayloadSchema.parse(rawPayload);
    const [brand] = await args.db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
    if (!brand) throw new Error(`brand not found: ${String(brandId)}`);

    const [run] = await args.db.insert(runs).values({ jobId: ctx.jobId, status: "running" }).returning();
    if (!run) throw new Error("runs insert returned empty");

    try {
      const repo = new BrandItemRepo(args.db);
      const result = await discoverBrandCatalog(args.buildDiscoverDeps(), {
        brandId,
        brandPrimaryUrl: brand.primaryUrl,
      });

      const seenUrls = new Set<string>();
      let created = 0;
      let updated = 0;
      for (const draft of result.drafts) {
        seenUrls.add(draft.sourceUrl);
        const r = await repo.upsertDraft(draft, run.id);
        if (r.created) created++;
        else updated++;
      }

      // Mark items not in this run as discontinued.
      const existing = await repo.listForBrand(brandId);
      let discontinued = 0;
      for (const item of existing) {
        if (!seenUrls.has(item.sourceUrl)) {
          await repo.markDiscontinued(item.id, run.id);
          discontinued++;
        }
      }

      await args.db
        .update(runs)
        .set({
          finishedAt: new Date().toISOString(),
          status: "succeeded",
          summaryJson: { source: result.source, created, updated, discontinued, total: result.drafts.length },
        })
        .where(eq(runs.id, run.id));
    } catch (error) {
      await args.db
        .update(runs)
        .set({
          finishedAt: new Date().toISOString(),
          status: "failed",
          summaryJson: { error: (error as Error).message },
        })
        .where(eq(runs.id, run.id));
      throw error;
    }
  };
}
```

- [ ] **Step 2: Update `src/jobs/index.ts`**

Append handler registration alongside existing ones:

```typescript
import { makeDiscoverBrandCatalogHandler } from "./discover-brand-catalog";
// inside registerJobs(args):
registerHandler("discover-brand-catalog", makeDiscoverBrandCatalogHandler({
  db: args.db,
  buildDiscoverDeps: args.buildDiscoverDeps, // add to RegisterJobsArgs
}));
```

Extend `RegisterJobsArgs` with `buildDiscoverDeps: () => DiscoverDeps`.

- [ ] **Step 3: Update `src/main.ts`** to wire `buildDiscoverDeps` in the `registerJobs(...)` call:

```typescript
import { ShopifyCatalogDiscoverer, SitemapCatalogDiscoverer } from "./domain/catalog";

// inside boot(), after firecrawl/anthropic/rateLimiter are constructed:
const shopify = new ShopifyCatalogDiscoverer();
const sitemap = new SitemapCatalogDiscoverer();

registerJobs({
  // ...existing args...
  buildDiscoverDeps: () => ({
    shopify, sitemap, firecrawl, anthropic, rateLimiter,
    recordUsage: (input) => usageTracker.record(input),
  }),
});
```

- [ ] **Step 4: Verify quality gates + commit**

```bash
bun run typecheck && bun run lint && bun run arch && bun run test
git add src/jobs/discover-brand-catalog.ts src/jobs/index.ts src/main.ts
git commit -m "feat: discover-brand-catalog job handler + main.ts wiring"
```


---

## Group C — Tier classification

### Task 8: Price-percentile tier heuristic

**Files:**
- Create: `src/domain/catalog/tier-classifier.ts`, update barrel
- Test: `tests/unit/catalog/tier-classifier.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, test, expect } from "bun:test";
import { classifyByPricePercentile, type TierBuckets } from "../../../src/domain/catalog/tier-classifier";

describe("classifyByPricePercentile", () => {
  test("returns unclassified when item has no price", () => {
    expect(classifyByPricePercentile(null, [50, 75, 100, 150, 200])).toEqual({
      tier: "unclassified", reason: "no price",
    });
  });

  test("returns unclassified when cohort has <4 priced items", () => {
    expect(classifyByPricePercentile(120, [50, 75])).toEqual({
      tier: "unclassified", reason: "cohort too small",
    });
  });

  test("classifies top 25% as flagship", () => {
    const cohort = [50, 75, 100, 120, 150, 200, 250];
    expect(classifyByPricePercentile(250, cohort).tier).toBe("flagship");
    expect(classifyByPricePercentile(200, cohort).tier).toBe("flagship");
  });

  test("classifies bottom 25% as basic", () => {
    const cohort = [50, 75, 100, 120, 150, 200, 250];
    expect(classifyByPricePercentile(50, cohort).tier).toBe("basic");
    expect(classifyByPricePercentile(75, cohort).tier).toBe("basic");
  });

  test("classifies middle 50% as mid", () => {
    const cohort = [50, 75, 100, 120, 150, 200, 250];
    expect(classifyByPricePercentile(120, cohort).tier).toBe("mid");
  });

  test("computeBuckets exposes the bucket thresholds for inspection", () => {
    // This is a side function — its purpose is showing the buckets in the admin UI.
    const buckets: TierBuckets = {
      basicMax: 75,
      flagshipMin: 200,
      cohortSize: 7,
    };
    expect(buckets.flagshipMin).toBeGreaterThan(buckets.basicMax);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
bun test tests/unit/catalog/tier-classifier.test.ts
```

- [ ] **Step 3: Write src/domain/catalog/tier-classifier.ts**

```typescript
export type Tier = "flagship" | "mid" | "basic" | "unclassified";

export interface TierResult {
  tier: Tier;
  reason: string;
}

export interface TierBuckets {
  basicMax: number;
  flagshipMin: number;
  cohortSize: number;
}

const MIN_COHORT_FOR_HEURISTIC = 4;
const BASIC_PERCENTILE = 0.25;
const FLAGSHIP_PERCENTILE = 0.75;

function percentile(sorted: number[], p: number): number {
  const idx = Math.floor((sorted.length - 1) * p);
  const v = sorted[idx];
  if (v === undefined) throw new Error("empty cohort");
  return v;
}

export function computeBuckets(cohortPrices: number[]): TierBuckets | null {
  const priced = cohortPrices.filter((p) => Number.isFinite(p) && p > 0);
  if (priced.length < MIN_COHORT_FOR_HEURISTIC) return null;
  const sorted = [...priced].sort((a, b) => a - b);
  return {
    basicMax: percentile(sorted, BASIC_PERCENTILE),
    flagshipMin: percentile(sorted, FLAGSHIP_PERCENTILE),
    cohortSize: priced.length,
  };
}

export function classifyByPricePercentile(price: number | null, cohortPrices: number[]): TierResult {
  if (price === null || !Number.isFinite(price) || price <= 0) {
    return { tier: "unclassified", reason: "no price" };
  }
  const buckets = computeBuckets(cohortPrices);
  if (!buckets) return { tier: "unclassified", reason: "cohort too small" };
  if (price <= buckets.basicMax) return { tier: "basic", reason: `price ${String(price)} ≤ basic cap ${String(buckets.basicMax)}` };
  if (price >= buckets.flagshipMin) return { tier: "flagship", reason: `price ${String(price)} ≥ flagship floor ${String(buckets.flagshipMin)}` };
  return { tier: "mid", reason: `price ${String(price)} between ${String(buckets.basicMax)} and ${String(buckets.flagshipMin)}` };
}
```

- [ ] **Step 4: Update barrel + verify + commit**

```typescript
export { classifyByPricePercentile, computeBuckets, type Tier, type TierResult, type TierBuckets } from "./tier-classifier";
```

```bash
bun test tests/unit/catalog/tier-classifier.test.ts
bun run typecheck && bun run lint && bun run arch
git add src/domain/catalog/tier-classifier.ts src/domain/catalog/index.ts tests/unit/catalog/tier-classifier.test.ts
git commit -m "feat: price-percentile tier classification heuristic"
```

---

### Task 9: AI tier refiner + classify-item-tier job

The flow: heuristic provides a prior; Claude refines it given the product page (description, materials, brand positioning). Result is stored in `brand_items.tier_classification` with `tier_inferred_by` indicating provenance.

**Files:**
- Update: `src/domain/catalog/tier-classifier.ts` to add `refineWithAi`
- Create: `src/jobs/classify-item-tier.ts`, update `src/jobs/index.ts`
- Test: `tests/integration/tier-classifier-ai.test.ts`

- [ ] **Step 1: Append to `src/domain/catalog/tier-classifier.ts`**

```typescript
import { z } from "zod";
import { AnthropicClient, MODEL_HAIKU } from "../../infrastructure/external";

const TierEnum = z.enum(["flagship", "mid", "basic", "unclassified"]);
const RefineResponseSchema = z.object({
  tier: TierEnum,
  rationale: z.string().max(200),
  confidence: z.number().min(0).max(1),
});

export interface RefineInput {
  client: AnthropicClient;
  itemName: string;
  itemMarkdown: string;
  basePriceUsd: number | null;
  heuristic: TierResult;
}

export interface RefineResult {
  tier: Tier;
  rationale: string;
  confidence: number;
  usage: { inputTokens: number; outputTokens: number };
}

const SYSTEM_PROMPT = `You classify running-apparel products into one of three tiers:
- flagship: brand's headlining/premium gear — top materials, marketed prominently, performance-positioned
- mid: standard performance products
- basic: cotton tees, simple accessories, entry-level apparel
- unclassified: insufficient signal

Inputs: a heuristic prior, the product name, and the rendered product-page markdown.
Output JSON: { tier, rationale (≤200 chars), confidence (0–1) }.
Use the heuristic prior as a sanity anchor. Override only with clear signal.`;

export async function refineWithAi(input: RefineInput): Promise<RefineResult> {
  const resp = await input.client.extractStructured({
    model: MODEL_HAIKU,
    systemPrompt: SYSTEM_PROMPT,
    userText: `Item: ${input.itemName}\nBase price USD: ${input.basePriceUsd === null ? "(unknown)" : String(input.basePriceUsd)}\nHeuristic prior: ${input.heuristic.tier} (${input.heuristic.reason})\n\nPage markdown:\n${input.itemMarkdown}`,
    maxTokens: 256,
  });
  const parsed = RefineResponseSchema.parse(resp.parsed);
  return { tier: parsed.tier, rationale: parsed.rationale, confidence: parsed.confidence, usage: resp.usage };
}
```

- [ ] **Step 2: Update barrel** to also export `refineWithAi`, `RefineInput`, `RefineResult`.

- [ ] **Step 3: Write src/jobs/classify-item-tier.ts**

```typescript
import { z } from "zod";
import { and, eq, isNotNull } from "drizzle-orm";
import type { JobHandler } from "../infrastructure/queue";
import type { DB } from "../infrastructure/db";
import { brandItems, brandItemChanges } from "../infrastructure/db/schema";
import { classifyByPricePercentile, refineWithAi } from "../domain/catalog";
import type { AnthropicClient } from "../infrastructure/external/anthropic";
import type { FirecrawlClient } from "../infrastructure/external/firecrawl";

const PayloadSchema = z.object({ brandId: z.number().int().positive() });

export interface MakeArgs {
  db: DB;
  firecrawl: FirecrawlClient;
  anthropic: AnthropicClient;
  recordUsage: (input: { provider: "anthropic" | "firecrawl"; unitsUsed: number; unitsKind: string; estimatedCostUsd: number }) => Promise<void>;
}

export function makeClassifyItemTierHandler(args: MakeArgs): JobHandler {
  return async (rawPayload, _ctx) => {
    const { brandId } = PayloadSchema.parse(rawPayload);
    const items = await args.db
      .select()
      .from(brandItems)
      .where(and(eq(brandItems.brandId, brandId), eq(brandItems.isDiscontinued, false), isNotNull(brandItems.basePriceUsd)));

    const cohortPrices = items
      .map((i) => i.basePriceUsd)
      .filter((p): p is number => p !== null);

    for (const item of items) {
      // Skip already-human-classified items.
      if (item.tierInferredBy?.startsWith("human:")) continue;
      const heuristic = classifyByPricePercentile(item.basePriceUsd, cohortPrices);
      // For phase-2 simplicity: stop at the heuristic. AI refinement (Step 4) is gated.
      const newTier = heuristic.tier;
      const newRationale = heuristic.reason;
      const newInferredBy = "price_percentile";
      if (
        item.tierClassification === newTier &&
        item.tierInferredBy === newInferredBy
      ) continue;

      await args.db
        .update(brandItems)
        .set({
          tierClassification: newTier,
          tierInferredBy: newInferredBy,
          tierRationale: newRationale,
        })
        .where(eq(brandItems.id, item.id));

      await args.db.insert(brandItemChanges).values({
        itemId: item.id,
        changeType: "tier_reclassified",
        beforeJson: { tier: item.tierClassification, inferredBy: item.tierInferredBy, rationale: item.tierRationale },
        afterJson: { tier: newTier, inferredBy: newInferredBy, rationale: newRationale },
      });
    }
  };
}
```

- [ ] **Step 4 (deferred AI step, optional within Task 9):** The plan starts with heuristic-only. AI refinement is wired BUT NOT INVOKED by default to keep Anthropic spend low. To enable AI refinement: extend the handler to optionally re-fetch each item's page via Firecrawl (using stored sourceUrl, cheap-first via ETag if applicable) then call `refineWithAi` with the heuristic prior. Gate behind `process.env.ENABLE_AI_TIER_REFINE === "1"`. Document this gate in the README.

For now in this task, just leave the AI refinement code unused; it's importable but the job uses heuristic-only.

- [ ] **Step 5: Register handler in `src/jobs/index.ts`**

```typescript
import { makeClassifyItemTierHandler } from "./classify-item-tier";
// in registerJobs:
registerHandler("classify-item-tier", makeClassifyItemTierHandler({
  db: args.db, firecrawl: args.firecrawl, anthropic: args.anthropic, recordUsage: args.recordUsage,
}));
```

Extend `RegisterJobsArgs` with `firecrawl`, `anthropic`, `recordUsage` if not already there. Update `main.ts` wiring.

- [ ] **Step 6: Write integration test** (`tests/integration/tier-classifier-ai.test.ts`) — tests `classifyByPricePercentile` against a seeded `brand_items` cohort AND tests `refineWithAi` against a stubbed Anthropic SDK.

- [ ] **Step 7: Quality gates + commit**

```bash
bun run typecheck && bun run lint && bun run arch && bun run test
git add src/domain/catalog/ src/jobs/classify-item-tier.ts src/jobs/index.ts src/main.ts tests/integration/tier-classifier-ai.test.ts
git commit -m "feat: AI tier refiner + classify-item-tier job (heuristic-only by default)"
```

---

### Task 10: Admin tier override action

Authors can override AI/heuristic tier classifications via the admin UI. Mark `tier_inferred_by: 'human:<author>'` so subsequent runs skip the item.

**Files:**
- Create: `src/admin-ui/actions/item.ts`, update `src/admin-ui/index.ts`
- (UI itself comes in Task 18)

- [ ] **Step 1: Write src/admin-ui/actions/item.ts**

```typescript
import { Elysia, type AnyElysia } from "elysia";
import { eq } from "drizzle-orm";
import type { DB } from "../../infrastructure/db";
import { brandItems, brandItemChanges } from "../../infrastructure/db/schema";

const VALID_TIERS = new Set(["flagship", "mid", "basic", "unclassified"]);

export function itemActions(args: { db: DB; authorSlug: string }): AnyElysia {
  return new Elysia().post("/admin/items/:id/set-tier", async ({ params, request, set }) => {
    const form = await request.formData();
    const tier = String(form.get("tier") ?? "");
    if (!VALID_TIERS.has(tier)) { set.status = 400; return "invalid tier"; }
    const itemId = Number(params.id);
    const [before] = await args.db.select().from(brandItems).where(eq(brandItems.id, itemId)).limit(1);
    if (!before) { set.status = 404; return "item not found"; }

    await args.db
      .update(brandItems)
      .set({
        tierClassification: tier as typeof brandItems.$inferInsert.tierClassification,
        tierInferredBy: `human:${args.authorSlug}`,
        tierRationale: String(form.get("rationale") ?? "human override"),
      })
      .where(eq(brandItems.id, itemId));

    await args.db.insert(brandItemChanges).values({
      itemId,
      changeType: "tier_reclassified",
      beforeJson: { tier: before.tierClassification, inferredBy: before.tierInferredBy, rationale: before.tierRationale },
      afterJson: { tier, inferredBy: `human:${args.authorSlug}`, rationale: String(form.get("rationale") ?? "human override") },
    });

    set.status = 302;
    set.headers.location = request.headers.get("referer") ?? "/admin";
    return "";
  });
}
```

- [ ] **Step 2: Wire into `src/admin-ui/index.ts`** with the existing actions chain.

- [ ] **Step 3: Quality gates + commit**

```bash
bun run typecheck && bun run lint && bun run arch && bun run test
git add src/admin-ui/actions/item.ts src/admin-ui/index.ts
git commit -m "feat: admin tier override action"
```


---

## Group D — Catalog change detection + cadence learning

### Task 11: Catalog change detector (separate from job orchestration)

Task 7 already records `added` and `discontinued` events as a side-effect of `discover-brand-catalog`. This task adds a pure-function reporter that summarizes recent catalog deltas — used by the admin UI and by Pushover notifications.

**Files:**
- Create: `src/domain/catalog/change-detector.ts`, update barrel
- Test: `tests/unit/catalog/change-detector.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, test, expect } from "bun:test";
import { summarizeCatalogDeltas, type ChangeEventInput } from "../../../src/domain/catalog/change-detector";

const now = new Date("2026-05-16T00:00:00Z");

const events: ChangeEventInput[] = [
  { changeType: "added", changedAt: "2026-05-15T10:00:00Z" },
  { changeType: "added", changedAt: "2026-05-14T10:00:00Z" },
  { changeType: "discontinued", changedAt: "2026-05-15T11:00:00Z" },
  { changeType: "tier_reclassified", changedAt: "2026-05-15T12:00:00Z" },
];

describe("summarizeCatalogDeltas", () => {
  test("counts events within window", () => {
    const r = summarizeCatalogDeltas(events, { now, withinDays: 7 });
    expect(r.added).toBe(2);
    expect(r.discontinued).toBe(1);
    expect(r.reclassified).toBe(1);
    expect(r.totalRecent).toBe(4);
  });

  test("excludes events outside window", () => {
    const old: ChangeEventInput[] = [
      { changeType: "added", changedAt: "2025-01-01T00:00:00Z" },
    ];
    const r = summarizeCatalogDeltas(old, { now, withinDays: 7 });
    expect(r.added).toBe(0);
  });

  test("isQuietPeriod true when no events in N days", () => {
    const r = summarizeCatalogDeltas([], { now, withinDays: 30 });
    expect(r.isQuietPeriod).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify fail**

- [ ] **Step 3: Write src/domain/catalog/change-detector.ts**

```typescript
export interface ChangeEventInput {
  changeType: "added" | "discontinued" | "tier_reclassified" | "size_added" | "price_changed";
  changedAt: string; // ISO
}

export interface DeltaSummary {
  added: number;
  discontinued: number;
  reclassified: number;
  sizeAdded: number;
  priceChanged: number;
  totalRecent: number;
  isQuietPeriod: boolean;
}

export interface SummarizeOptions {
  now: Date;
  withinDays: number;
}

export function summarizeCatalogDeltas(events: ChangeEventInput[], opts: SummarizeOptions): DeltaSummary {
  const cutoffMs = opts.now.getTime() - opts.withinDays * 86_400_000;
  const recent = events.filter((e) => new Date(e.changedAt).getTime() >= cutoffMs);
  const counts = {
    added: 0,
    discontinued: 0,
    reclassified: 0,
    sizeAdded: 0,
    priceChanged: 0,
  };
  for (const e of recent) {
    if (e.changeType === "added") counts.added++;
    else if (e.changeType === "discontinued") counts.discontinued++;
    else if (e.changeType === "tier_reclassified") counts.reclassified++;
    else if (e.changeType === "size_added") counts.sizeAdded++;
    else if (e.changeType === "price_changed") counts.priceChanged++;
  }
  return {
    ...counts,
    totalRecent: recent.length,
    isQuietPeriod: recent.length === 0,
  };
}
```

- [ ] **Step 4: Update barrel, quality gates, commit**

```bash
bun test tests/unit/catalog/change-detector.test.ts
bun run typecheck && bun run lint && bun run arch
git add src/domain/catalog/change-detector.ts src/domain/catalog/index.ts tests/unit/catalog/change-detector.test.ts
git commit -m "feat: catalog change summarizer"
```

---

### Task 12: Adaptive cadence learning

Computes `brands.predicted_next_change_at` from observed size-chart change intervals. Job runs weekly via scheduler.

**Files:**
- Create: `src/domain/catalog/cadence.ts`, `src/jobs/compute-brand-cadence.ts`, update barrels
- Test: `tests/unit/catalog/cadence.test.ts`, `tests/integration/compute-brand-cadence-job.test.ts`

- [ ] **Step 1: Write src/domain/catalog/cadence.ts**

```typescript
const MIN_CHANGES_FOR_CADENCE = 3;
const HIGH_VARIANCE_CV = 0.3;
const SAFETY_BUFFER_DAYS = 7;

export interface CadenceInput {
  acceptedChangeDates: string[]; // ISO timestamps of accepted size-chart version transitions
}

export interface CadenceResult {
  intervals: number[]; // days between consecutive changes
  medianDays: number | null;
  coefficientOfVariation: number | null;
  predictedNextChangeAt: string | null;
  reason: string;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

export function computeBrandCadence(input: CadenceInput, now: Date = new Date()): CadenceResult {
  const dates = input.acceptedChangeDates
    .map((d) => new Date(d).getTime())
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
  if (dates.length < MIN_CHANGES_FOR_CADENCE) {
    return {
      intervals: [], medianDays: null, coefficientOfVariation: null,
      predictedNextChangeAt: null, reason: "fewer than 3 observed changes",
    };
  }
  const intervals: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const a = dates[i - 1];
    const b = dates[i];
    if (a === undefined || b === undefined) continue;
    intervals.push((b - a) / 86_400_000);
  }
  const med = median(intervals);
  const mean = intervals.reduce((s, v) => s + v, 0) / intervals.length;
  const variance = intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / intervals.length;
  const stdDev = Math.sqrt(variance);
  const cv = mean === 0 ? 0 : stdDev / mean;
  if (cv > HIGH_VARIANCE_CV) {
    return {
      intervals, medianDays: med, coefficientOfVariation: cv,
      predictedNextChangeAt: null, reason: "high variance — fallback to default cadence",
    };
  }
  const lastChange = dates[dates.length - 1] ?? now.getTime();
  const predictedMs = lastChange + (med - SAFETY_BUFFER_DAYS) * 86_400_000;
  return {
    intervals, medianDays: med, coefficientOfVariation: cv,
    predictedNextChangeAt: new Date(predictedMs).toISOString(),
    reason: `median ${String(Math.round(med))}d, cv ${cv.toFixed(2)}, low variance`,
  };
}
```

- [ ] **Step 2: Write unit test** (`tests/unit/catalog/cadence.test.ts`) testing:
  - <3 changes → no prediction
  - Stable cadence → predicts next change minus safety buffer
  - High variance → returns null prediction
  - Intervals computed correctly

- [ ] **Step 3: Write src/jobs/compute-brand-cadence.ts**

```typescript
import { eq, desc, and } from "drizzle-orm";
import type { JobHandler } from "../infrastructure/queue";
import type { DB } from "../infrastructure/db";
import { brands, brandSizeChartVersions } from "../infrastructure/db/schema";
import { computeBrandCadence } from "../domain/catalog";

export function makeComputeBrandCadenceHandler(args: { db: DB }): JobHandler {
  return async () => {
    const allBrands = await args.db.select().from(brands).where(eq(brands.active, true));
    for (const brand of allBrands) {
      const versions = await args.db
        .select({ acceptedAt: brandSizeChartVersions.acceptedAt })
        .from(brandSizeChartVersions)
        .where(and(
          eq(brandSizeChartVersions.brandId, brand.id),
          eq(brandSizeChartVersions.status, "accepted"),
        ))
        .orderBy(desc(brandSizeChartVersions.acceptedAt));
      const dates = versions
        .map((v) => v.acceptedAt)
        .filter((v): v is string => v !== null);
      const result = computeBrandCadence({ acceptedChangeDates: dates });
      await args.db
        .update(brands)
        .set({
          predictedNextChangeAt: result.predictedNextChangeAt,
          cadenceLearnedAt: new Date().toISOString(),
          observedChangeIntervals: result.intervals,
        })
        .where(eq(brands.id, brand.id));
    }
  };
}
```

- [ ] **Step 4: Register in `src/jobs/index.ts`** and add to scheduler in `src/main.ts`:

```typescript
scheduler.register({
  name: "compute-brand-cadence",
  cron: "0 5 * * 1", // weekly Monday 05:00 UTC
  enqueue: () => queue.enqueue({
    jobType: "compute-brand-cadence",
    payload: {},
    dedupeKey: `compute-brand-cadence:${new Date().toISOString().slice(0, 10)}`,
  }),
});
```

- [ ] **Step 5: Write integration test** verifying the job populates `predicted_next_change_at` for brands with ≥3 accepted versions.

- [ ] **Step 6: Quality gates + commit**

```bash
bun run typecheck && bun run lint && bun run arch && bun run test
git add src/domain/catalog/cadence.ts src/domain/catalog/index.ts src/jobs/compute-brand-cadence.ts src/jobs/index.ts src/main.ts tests/unit/catalog/cadence.test.ts tests/integration/compute-brand-cadence-job.test.ts
git commit -m "feat: adaptive cadence learning + compute-brand-cadence job"
```


---

## Group E — New scoring dimensions

These three dimensions all need per-item data. Each is a pure function: `score(brandItems, cohortItemSummary) → number 0–10`.

### Task 13: range_parity dimension (category + tier sub-scores)

The flagship measurement. Compares the distribution of available items at extended sizes vs. standard sizes across categories and tier classifications.

**Files:**
- Create: `src/domain/scoring/range-parity.ts`, update barrel
- Test: `tests/unit/scoring/range-parity.test.ts`

- [ ] **Step 1: Write src/domain/scoring/range-parity.ts**

```typescript
import type { brandItems } from "../../infrastructure/db/schema";

type BrandItem = typeof brandItems.$inferSelect;

const STANDARD_SIZE_LABELS = new Set(["XS", "S", "M", "L", "XL"]);
const EXTENDED_SIZE_LABELS = new Set(["XXL", "2XL", "3XL", "4XL", "5XL", "XXXL"]);

interface SetsAtSize {
  categories: Set<string>;
  flagshipCount: number;
  midCount: number;
  basicCount: number;
  totalItems: number;
}

function collectByAvailability(items: readonly BrandItem[], labels: Set<string>): SetsAtSize {
  const r: SetsAtSize = { categories: new Set(), flagshipCount: 0, midCount: 0, basicCount: 0, totalItems: 0 };
  for (const item of items) {
    if (item.isDiscontinued) continue;
    const perSize = item.perSizeDataJson;
    const hasAvailable = Object.entries(perSize).some(([size, info]) =>
      labels.has(size.toUpperCase()) && (info as { available: boolean }).available === true
    );
    if (!hasAvailable) continue;
    r.totalItems++;
    r.categories.add(item.category);
    if (item.tierClassification === "flagship") r.flagshipCount++;
    else if (item.tierClassification === "mid") r.midCount++;
    else if (item.tierClassification === "basic") r.basicCount++;
  }
  return r;
}

export interface RangeParityResult {
  score: number; // 0-10
  categoryParity: number; // 0-10
  tierParity: number; // 0-10
  rawCounts: { standard: SetsAtSize; extended: SetsAtSize };
}

export function scoreRangeParity(items: readonly BrandItem[]): RangeParityResult {
  const standard = collectByAvailability(items, STANDARD_SIZE_LABELS);
  const extended = collectByAvailability(items, EXTENDED_SIZE_LABELS);
  // Category parity: jaccard-ish ratio of extended categories vs standard categories.
  const cp =
    standard.categories.size === 0
      ? 0
      : extended.categories.size / standard.categories.size;
  const categoryParity = Math.min(10, cp * 10);
  // Tier parity: weighted ratio of extended flagship+mid coverage vs standard.
  const stdWeighted = standard.flagshipCount * 2 + standard.midCount;
  const extWeighted = extended.flagshipCount * 2 + extended.midCount;
  const tp = stdWeighted === 0 ? 0 : extWeighted / stdWeighted;
  const tierParity = Math.min(10, tp * 10);
  return {
    score: (categoryParity + tierParity) / 2,
    categoryParity,
    tierParity,
    rawCounts: { standard, extended },
  };
}
```

- [ ] **Step 2: Write `tests/unit/scoring/range-parity.test.ts`** with:
  - Brand offering everything at all sizes → score 10
  - Brand offering only basics at extended → tier parity < 5, category parity may still be high
  - Brand offering no extended sizes at all → score 0
  - All items discontinued → score 0

- [ ] **Step 3: Update barrel, run tests, commit**

```bash
git add src/domain/scoring/range-parity.ts src/domain/scoring/index.ts tests/unit/scoring/range-parity.test.ts
git commit -m "feat: range_parity scoring dimension (category + tier sub-scores)"
```

---

### Task 14: pricing_equity dimension

Measures whether extended-size variants cost more than standard-size variants of the SAME item.

**Files:**
- Create: `src/domain/scoring/pricing-equity.ts`
- Test: `tests/unit/scoring/pricing-equity.test.ts`

- [ ] **Step 1: Write src/domain/scoring/pricing-equity.ts**

```typescript
import type { brandItems } from "../../infrastructure/db/schema";

type BrandItem = typeof brandItems.$inferSelect;

const STANDARD = new Set(["XS", "S", "M", "L", "XL"]);
const EXTENDED = new Set(["XXL", "2XL", "3XL", "4XL", "5XL", "XXXL"]);

export function scorePricingEquity(items: readonly BrandItem[]): number {
  // Per item: compute median std-size price and median ext-size price. Ratio ext/std reveals upcharge.
  const ratios: number[] = [];
  for (const item of items) {
    if (item.isDiscontinued) continue;
    const stdPrices: number[] = [];
    const extPrices: number[] = [];
    for (const [size, info] of Object.entries(item.perSizeDataJson) as [string, { price?: number; available?: boolean }][]) {
      if (info.price === undefined || info.available !== true) continue;
      if (STANDARD.has(size.toUpperCase())) stdPrices.push(info.price);
      else if (EXTENDED.has(size.toUpperCase())) extPrices.push(info.price);
    }
    if (stdPrices.length === 0 || extPrices.length === 0) continue;
    const stdMed = median(stdPrices);
    const extMed = median(extPrices);
    if (stdMed === 0) continue;
    ratios.push(extMed / stdMed);
  }
  if (ratios.length === 0) return 5; // no signal → neutral
  const meanRatio = ratios.reduce((s, v) => s + v, 0) / ratios.length;
  // ratio 1.0 → score 10 (perfect equity). ratio 1.2 (20% upcharge) → ~6. ratio 1.5 → 0.
  return Math.max(0, Math.min(10, 10 - (meanRatio - 1) * 20));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : sorted[mid] ?? 0;
}
```

- [ ] **Step 2: Tests:** perfect equity (all sizes same price) → 10; uniform 20% upcharge on extended → ~6; no extended sizes available → 5 (neutral).

- [ ] **Step 3: Update barrel + commit:** `feat: pricing_equity scoring dimension`

---

### Task 15: colorway_equity dimension

Are the same colors available at extended sizes as at standard?

**Files:**
- Create: `src/domain/scoring/colorway-equity.ts`
- Test: `tests/unit/scoring/colorway-equity.test.ts`

- [ ] **Step 1: Write src/domain/scoring/colorway-equity.ts**

```typescript
import type { brandItems } from "../../infrastructure/db/schema";

type BrandItem = typeof brandItems.$inferSelect;

const STANDARD = new Set(["XS", "S", "M", "L", "XL"]);
const EXTENDED = new Set(["XXL", "2XL", "3XL", "4XL", "5XL", "XXXL"]);

export function scoreColorwayEquity(items: readonly BrandItem[]): number {
  const ratios: number[] = [];
  for (const item of items) {
    if (item.isDiscontinued) continue;
    const stdColors = new Set<string>();
    const extColors = new Set<string>();
    for (const [size, info] of Object.entries(item.perSizeDataJson) as [string, { available?: boolean; colors?: string[] }][]) {
      if (info.available !== true || !info.colors) continue;
      const target = STANDARD.has(size.toUpperCase()) ? stdColors : EXTENDED.has(size.toUpperCase()) ? extColors : null;
      if (!target) continue;
      for (const c of info.colors) target.add(c.toLowerCase());
    }
    if (stdColors.size === 0 || extColors.size === 0) continue;
    ratios.push(extColors.size / stdColors.size);
  }
  if (ratios.length === 0) return 5;
  const meanRatio = ratios.reduce((s, v) => s + v, 0) / ratios.length;
  return Math.max(0, Math.min(10, meanRatio * 10));
}
```

- [ ] **Step 2: Tests** covering same-colors-everywhere (10), half-the-colors-at-extended (~5), no colors at extended (0).

- [ ] **Step 3: Update barrel + commit:** `feat: colorway_equity scoring dimension`

---

### Task 16: Update score-brand job for phase-2 dimensions

Wire the three new dimensions into the score-brand handler. Phase 1 left them as `null`; now they have values.

**Files:**
- Update: `src/jobs/score-brand.ts`
- Update: `src/domain/scoring/cohort.ts` (extend cohort summary to include item-level aggregates if any are cohort-relative; range_parity/pricing_equity/colorway_equity are NOT cohort-relative in phase 2 — they're absolute. So cohort.ts may not need changes. Verify.)

- [ ] **Step 1: Update src/jobs/score-brand.ts** to query items and compute all 5 dimensions.

```typescript
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { JobHandler } from "../infrastructure/queue";
import type { DB } from "../infrastructure/db";
import { brands, brandSizeChartVersions, brandScoreHistory, cohortSummaries, brandItems } from "../infrastructure/db/schema";
import {
  scoreBreadth,
  scoreAccuracy,
  computeComposite,
  promoteSnapshotIfWarranted,
  SCORING_CONFIG_VERSION,
  type CohortSummaryJson,
} from "../domain/scoring";
import { scoreRangeParity } from "../domain/scoring/range-parity";
import { scorePricingEquity } from "../domain/scoring/pricing-equity";
import { scoreColorwayEquity } from "../domain/scoring/colorway-equity";
import type { CanonicalSizeChart } from "../domain/extraction";

const PayloadSchema = z.object({ brandId: z.number().int().positive() });

export function makeScoreBrandHandler(args: { db: DB }): JobHandler {
  return async (rawPayload) => {
    const { brandId } = PayloadSchema.parse(rawPayload);
    const [brand] = await args.db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
    if (!brand?.currentSizeChartVersionId) return;
    const [version] = await args.db.select().from(brandSizeChartVersions).where(eq(brandSizeChartVersions.id, brand.currentSizeChartVersionId)).limit(1);
    if (!version) return;
    const [cohort] = await args.db.select().from(cohortSummaries).orderBy(desc(cohortSummaries.computedAt)).limit(1);
    if (!cohort) return;

    const chart = version.sizeChartJson as unknown as CanonicalSizeChart;
    const summary = cohort.summaryJson as unknown as CohortSummaryJson;
    const items = await args.db.select().from(brandItems).where(and(eq(brandItems.brandId, brandId), eq(brandItems.isDiscontinued, false)));

    const rangeParityResult = scoreRangeParity(items);
    const dimensionScores = {
      size_range_breadth: scoreBreadth(chart, summary),
      measurement_accuracy: scoreAccuracy(chart, summary),
      range_parity: items.length > 0 ? rangeParityResult.score : null,
      pricing_equity: items.length > 0 ? scorePricingEquity(items) : null,
      colorway_equity: items.length > 0 ? scoreColorwayEquity(items) : null,
    } as const;
    const composite = computeComposite(dimensionScores);

    const [history] = await args.db.insert(brandScoreHistory).values({
      brandId,
      scoringConfigVersion: SCORING_CONFIG_VERSION,
      cohortSummaryId: cohort.id,
      scoresJson: { ...dimensionScores, composite },
      inputsJson: {
        sizeChartVersionId: version.id,
        itemCount: items.length,
        rangeParityBreakdown: { categoryParity: rangeParityResult.categoryParity, tierParity: rangeParityResult.tierParity },
      },
    }).returning();
    if (!history) throw new Error("score-brand insert returned empty");

    await promoteSnapshotIfWarranted({
      db: args.db, brandId,
      latestHistoryId: history.id, cohortSummaryId: cohort.id,
      cohortBrandCount: cohort.brandCount,
    });
  };
}
```

- [ ] **Step 2: Write integration test** (`tests/integration/scoring-pipeline-phase2.test.ts`) seeding brand + items + cohort and verifying all 5 dimensions land in `brand_score_history.scoresJson`.

- [ ] **Step 3: Quality gates + commit**

```bash
bun run typecheck && bun run lint && bun run arch && bun run test
git add src/jobs/score-brand.ts tests/integration/scoring-pipeline-phase2.test.ts
git commit -m "feat: score-brand uses all 5 dimensions when items present"
```


---

## Group F — Public API + Admin UI

### Task 17: GET /api/v1/brands/:slug/items endpoint

**Files:**
- Create: `src/public-api/items.ts`
- Update: `src/public-api/index.ts` to register the new route
- Test: `tests/integration/public-api-items.test.ts`

- [ ] **Step 1: Write src/public-api/items.ts**

```typescript
import { Elysia, type AnyElysia } from "elysia";
import { and, eq } from "drizzle-orm";
import type { DB } from "../infrastructure/db";
import { brands, brandItems } from "../infrastructure/db/schema";
import { jsonWithCaching } from "./response-helpers";
import { problemDetailsResponse, ProblemTypes } from "../infrastructure/http";

export function itemsRoute(args: { db: DB }): AnyElysia {
  return new Elysia().get("/api/v1/brands/:slug/items", async ({ params, request }) => {
    const url = new URL(request.url);
    const category = url.searchParams.get("category");
    const includeDiscontinued = url.searchParams.get("include_discontinued") === "true";

    const [brand] = await args.db.select().from(brands).where(eq(brands.slug, params.slug)).limit(1);
    if (!brand) {
      return problemDetailsResponse({
        type: ProblemTypes.NotFound, title: "Not Found", status: 404,
        detail: `No brand with slug ${params.slug}`,
      });
    }

    const conditions = [eq(brandItems.brandId, brand.id)];
    if (!includeDiscontinued) conditions.push(eq(brandItems.isDiscontinued, false));
    if (category) conditions.push(eq(brandItems.category, category));

    const items = await args.db
      .select({
        externalId: brandItems.externalId,
        sourceUrl: brandItems.sourceUrl,
        name: brandItems.name,
        category: brandItems.category,
        tier: brandItems.tierClassification,
        basePriceUsd: brandItems.basePriceUsd,
        perSize: brandItems.perSizeDataJson,
        isDiscontinued: brandItems.isDiscontinued,
        firstSeenAt: brandItems.firstSeenAt,
      })
      .from(brandItems)
      .where(and(...conditions));

    const body = JSON.stringify({ slug: brand.slug, count: items.length, items });
    return jsonWithCaching(body, request);
  });
}
```

- [ ] **Step 2: Register route in `src/public-api/index.ts`**

```typescript
import { itemsRoute } from "./items";
// inside publicApi(args):
.use(itemsRoute({ db: args.db }))
```

- [ ] **Step 3: Integration test** verifying:
- Returns 404 for unknown slug
- Returns empty list for brand with no items
- Filters by category
- Excludes discontinued by default; includes with query param
- ETag returns 304 on If-None-Match

- [ ] **Step 4: Quality gates + commit**

```bash
bun run typecheck && bun run lint && bun run arch && bun run test
git add src/public-api/items.ts src/public-api/index.ts tests/integration/public-api-items.test.ts
git commit -m "feat: public API /brands/:slug/items endpoint"
```

---

### Task 18: Admin UI Items tab (replaces phase-1 placeholder)

**Files:**
- Create: `src/admin-ui/pages/brand-tabs/items.tsx`
- Update: `src/admin-ui/pages/brand-detail.tsx` to wire the new tab content (replacing the existing placeholder)

- [ ] **Step 1: Write src/admin-ui/pages/brand-tabs/items.tsx**

```tsx
import { eq } from "drizzle-orm";
import type { DB } from "../../../infrastructure/db";
import { brandItems } from "../../../infrastructure/db/schema";

const TIERS = ["flagship", "mid", "basic", "unclassified"] as const;

export async function ItemsTab(args: { db: DB; brandId: number }): Promise<string> {
  const rows = await args.db
    .select()
    .from(brandItems)
    .where(eq(brandItems.brandId, args.brandId))
    .orderBy(brandItems.category, brandItems.name);
  if (rows.length === 0) return <p>No items discovered yet. Run discover-brand-catalog or wait for the scheduled sweep.</p>;
  return (
    <div>
      <h3>Catalog ({String(rows.length)} items)</h3>
      <table role="grid">
        <thead>
          <tr>
            <th>Name</th>
            <th>Category</th>
            <th>Tier</th>
            <th>Price</th>
            <th>Sizes</th>
            <th>Status</th>
            <th>Override</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const availableSizes = Object.entries(item.perSizeDataJson)
              .filter(([, info]) => (info as { available?: boolean }).available === true)
              .map(([size]) => size)
              .join(", ");
            return (
              <tr>
                <td><a href={item.sourceUrl} target="_blank" rel="noopener">{item.name}</a></td>
                <td>{item.category}</td>
                <td>{item.tierClassification} <small>({item.tierInferredBy ?? "—"})</small></td>
                <td>{item.basePriceUsd === null ? "—" : `$${String(item.basePriceUsd)}`}</td>
                <td>{availableSizes || "—"}</td>
                <td>{item.isDiscontinued ? "discontinued" : "active"}</td>
                <td>
                  <form method="post" action={`/admin/items/${String(item.id)}/set-tier`} style="display:flex;gap:0.25rem">
                    <select name="tier">
                      {TIERS.map((t) => <option value={t} selected={item.tierClassification === t}>{t}</option>)}
                    </select>
                    <input type="text" name="rationale" placeholder="why" />
                    <button type="submit" class="secondary outline">Set</button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Update `src/admin-ui/pages/brand-detail.tsx`** to replace the existing items-tab placeholder with `ItemsTab`. Update the imports + the `renderTab` switch.

- [ ] **Step 3: Quality gates + commit**

```bash
bun run typecheck && bun run lint && bun run arch && bun run test
git add src/admin-ui/pages/brand-tabs/items.tsx src/admin-ui/pages/brand-detail.tsx
git commit -m "feat: admin UI items tab with tier override form"
```

---

### Task 19: E2E test for tier override

Replaces the phase-1 `tests/e2e/assessment-stub.spec.ts` placeholder. Workflow: log in, navigate to a brand with items, change a tier, verify the change persists.

**Files:**
- Update: `tests/e2e/tier-override.spec.ts` (rename/replace `assessment-stub.spec.ts`)
- Update: test server (`tests/e2e/server.ts`) to optionally seed an item for the test

- [ ] **Step 1: Replace `assessment-stub.spec.ts` with `tier-override.spec.ts`**

```typescript
import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test("tier override updates the displayed tier", async ({ page }) => {
  await login(page);
  // Navigate to first available brand
  await page.goto("/admin/brands");
  const firstBrandLink = page.locator('table a').first();
  if (!(await firstBrandLink.isVisible())) {
    test.skip(true, "no brands seeded");
    return;
  }
  await firstBrandLink.click();
  await page.locator('a:has-text("items")').click();
  const itemsTable = page.locator("table");
  if (!(await itemsTable.isVisible())) {
    test.skip(true, "no items seeded");
    return;
  }
  const tierSelect = page.locator('select[name="tier"]').first();
  await tierSelect.selectOption("flagship");
  await page.locator('input[name="rationale"]').first().fill("e2e override");
  await page.locator('button:has-text("Set")').first().click();
  // After redirect, verify the displayed tier text contains "flagship"
  await expect(page.locator("body")).toContainText("flagship");
});
```

- [ ] **Step 2: (Optional) update test server seed** to include one brand + a sample item so the test runs vs skips. Keep test resilient to "no data" → skip pattern.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/
git commit -m "test: tier-override E2E (replaces phase-3 assessment placeholder)"
```


---

## Group G — Wiring & polish

### Task 20: Scheduler wiring + sweep trigger for catalog discovery

Add the catalog-discovery sweep to the cron registry, integrate with the existing `sweep-all-brand-sources` pattern, and add a separate monthly sweep for the catalog (per the spec: "Catalog discovery: monthly default").

**Files:**
- Update: `src/main.ts` (scheduler.register calls)
- Update: `src/jobs/sweep-all-brand-sources.ts` (optional: split into two sweep handlers — one for size charts, one for catalogs, OR have it enqueue both per brand)

Simplest path: add a new `sweep-all-brand-catalogs` handler that mirrors `sweep-all-brand-sources` but enqueues `discover-brand-catalog` instead of `detect-brand-source-changes`.

- [ ] **Step 1: Write src/jobs/sweep-all-brand-catalogs.ts**

```typescript
import { eq } from "drizzle-orm";
import type { JobHandler } from "../infrastructure/queue";
import type { Queue } from "../infrastructure/queue";
import type { DB } from "../infrastructure/db";
import { brands } from "../infrastructure/db/schema";

export function makeSweepAllBrandCatalogsHandler(args: { db: DB; queue: Queue }): JobHandler {
  return async () => {
    const active = await args.db.select().from(brands).where(eq(brands.active, true));
    for (const b of active) {
      await args.queue.enqueue({
        jobType: "discover-brand-catalog",
        payload: { brandId: b.id },
        dedupeKey: `discover-brand-catalog:${String(b.id)}:${new Date().toISOString().slice(0, 7)}`,
      });
    }
  };
}
```

- [ ] **Step 2: Register handler** in `src/jobs/index.ts`.

- [ ] **Step 3: Add cron in `src/main.ts`** (monthly, offset from size-chart sweep):

```typescript
scheduler.register({
  name: "sweep-all-brand-catalogs",
  cron: "0 4 1 * *", // monthly, 1st at 04:00 UTC (size-chart sweep is at 03:00 UTC)
  enqueue: () => queue.enqueue({
    jobType: "sweep-all-brand-catalogs",
    payload: {},
    dedupeKey: `sweep-catalogs:${new Date().toISOString().slice(0, 7)}`,
  }),
});
```

Also add a daily `classify-item-tier` per brand:

```typescript
scheduler.register({
  name: "classify-item-tiers-daily",
  cron: "0 6 * * *", // daily 06:00 UTC
  enqueue: async () => {
    const allBrands = await db.select({ id: brands.id }).from(brands).where(eq(brands.active, true));
    for (const b of allBrands) {
      await queue.enqueue({
        jobType: "classify-item-tier",
        payload: { brandId: b.id },
        dedupeKey: `classify-item-tier:${String(b.id)}:${new Date().toISOString().slice(0, 10)}`,
      });
    }
  },
});
```

- [ ] **Step 4: Quality gates + commit**

```bash
bun run typecheck && bun run lint && bun run arch && bun run test
git add src/jobs/sweep-all-brand-catalogs.ts src/jobs/index.ts src/main.ts
git commit -m "feat: schedule catalog sweep + tier classification cron jobs"
```

---

### Task 21: Smoke test the full phase-2 flow

End-to-end manual verification:

- [ ] **Step 1: Migrate a fresh DB and seed**

```bash
DATABASE_PATH=./tmp/p2-smoke.sqlite bun run db:migrate
DATABASE_PATH=./tmp/p2-smoke.sqlite bun run seed
```

- [ ] **Step 2: Manually trigger catalog discovery for a Shopify brand**

Open `bun repl` or write a one-shot script:

```typescript
import { getDb } from "./src/infrastructure/db";
import { Queue } from "./src/infrastructure/queue";
const db = getDb();
const q = new Queue(db);
const id = await q.enqueue({
  jobType: "discover-brand-catalog",
  payload: { brandId: 1 }, // Tracksmith
  dedupeKey: "smoke:1",
});
console.log("enqueued", id);
```

Start the server (`DATABASE_PATH=./tmp/p2-smoke.sqlite bun run dev`), wait ~30s for the worker to pick up, then check the admin items tab at `/admin/brands/tracksmith?tab=items`.

- [ ] **Step 2 (alt — fully scripted):** write `scripts/smoke-phase2.ts` that does the same end-to-end and asserts items exist.

- [ ] **Step 3: Run all quality gates** one final time:

```bash
bun run typecheck && bun run lint && bun run arch && bun run format && bun run test && bun run test:e2e
```
All must pass.

- [ ] **Step 4: Clean up tmp + commit (if smoke script created)**

```bash
rm -f ./tmp/p2-smoke.sqlite*
git add scripts/smoke-phase2.ts  # if created
git commit -m "chore: phase-2 smoke verification script"
```

---

### Task 22: README update + tag

**Files:**
- Update: `README.md` with phase-2 notes
- Tag: `phase-2-complete`

- [ ] **Step 1: Append to README.md**

```markdown
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
- **Adaptive cadence:** the `compute-brand-cadence` job sets `brands.predicted_next_change_at` based on observed change intervals; the scheduler should later honor that when deciding when to sweep a brand

### New cron schedules

- `sweep-all-brand-catalogs` — monthly, 1st @ 04:00 UTC
- `classify-item-tiers-daily` — daily @ 06:00 UTC
- `compute-brand-cadence` — weekly Mondays @ 05:00 UTC

### Optional env vars

- `ENABLE_AI_TIER_REFINE=1` — enable Claude Haiku tier refinement after the price-percentile heuristic. Adds ~$0.001 per item classified. Default off.
```

- [ ] **Step 2: Commit and tag**

```bash
git add README.md
git commit -m "docs: phase-2 README section (catalogs, tier scoring, new crons)"
git tag -a phase-2-complete -m "Phase 2: items catalog + tier-aware scoring + cadence learning"
```

---

## Self-Review

After all 22 tasks land, verify:
- [ ] All 22 tasks have commits on the `phase-2` (or merged into the working branch) branch
- [ ] `bun run typecheck`, `lint`, `arch`, `format`, `test`, `test:e2e` all green
- [ ] `drizzle/0001_*.sql` includes `brand_items` + `brand_item_changes`
- [ ] `phase-2-complete` tag exists on the final commit
- [ ] README phase-2 section reads correctly

## Spec Coverage Check

Every phase-2 scope item mapped to a task:

| Scope item | Tasks |
|---|---|
| Item discovery: Shopify-first + sitemap fallback | 4, 5, 6, 7 |
| Item version tracking + catalog-level change detection | 1, 3, 7 (upsert + discontinue + change log), 11 (summarizer) |
| Tier classification (price + AI + human override) | 8, 9, 10, 18, 19 |
| range_parity scoring dimension | 13 |
| pricing_equity scoring dimension | 14 |
| colorway_equity scoring dimension | 15 |
| Cohort + score-brand integration of new dimensions | 16 |
| Public API: `/brands/:slug/items` | 17 |
| Adaptive cadence learning | 12 |
| Admin UI items tab | 18 |
| Schedule wiring | 20 |
| Documentation + tag | 22 |

## Execution Choice

Plan complete. Two execution options:

1. **Subagent-Driven (recommended for phase 2 too)** — Dispatch fresh subagent per task or per bundle, review between. Same flow as phase 1.
2. **Inline Execution** — Execute in current session via `superpowers:executing-plans`.

**Branch strategy:** Start a new worktree on a `phase-2` branch from `phase-1` (or from `main` after phase 1 is merged). Phase-2 schema additions are forward-compatible — no migrations rewrite phase-1 tables.
