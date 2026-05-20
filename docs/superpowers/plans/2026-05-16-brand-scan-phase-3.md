# brand-scan Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make brand-scan the canonical source of brand-level subjective opinion. Author brand assessments (5 fixed-dimension ratings + free-form prose markdown) are created and edited inside brand-scan; AI extraction uses them as calibration anchors; the score engine surfaces divergence between objective and subjective scores; a one-shot CLI backfills historical `sizeOptions` ratings from the biglongrun.com Astro blog repo.

**Architecture:** Adds one schema table (`author_brand_assessments`), one domain service (`AuthorAssessmentService`), one admin UI tab + global page, one public API endpoint, one CLI script, and two integration points (extraction prior-context + score-brand divergence flag). No new external dependencies expected beyond a server-side markdown renderer (`marked`) and HTML sanitizer (`sanitize-html`).

**Tech Stack:** Same as phases 1 + 2.

**Spec reference:** `docs/superpowers/specs/2026-05-16-brand-scan-design.md`
**Previous plans:** `docs/superpowers/plans/2026-05-16-brand-scan-phase-1.md`, `2026-05-16-brand-scan-phase-2.md`

**Phase 3 scope from the spec (section 12):**

- Author brand assessments CRUD (5 fixed dimensions + markdown editor)
- One-shot CLI tool: `bun run backfill-blog-assessments --blog-repo <path>`
- Public API: `/api/v1/brands/:slug/assessments`
- AI extraction prompt enriched with author assessments as calibration anchors
- Divergence flag in admin (objective score vs. author rating)

**Out of scope (deferred to later phases):**

- Brand suggestions + Reddit ingestion + seed importers (phase 4)
- Eden client + summary digest (phase 5)
- Email-as-signal change detection (future)
- Blog repo schema changes (separate follow-up project in biglongrun.com after this lands)

**Conventions inherited from phase 1 + 2 (in `CLAUDE.md`):**

1. Strict TypeScript, no `!` non-null assertions, ESLint type-checked + unicorn + sonarjs
2. Service pattern for multi-step writes (`*Service.ts` in `src/domain/<area>/`); transactions inside services
3. `dependency-cruiser` rule `actions-must-use-services` — `src/admin-ui/actions/**` cannot import schema tables
4. `getEnv()` lazy getter, NOT eager `env` constant
5. `estimateAnthropicCost(usage, model)` for cost calculations; no inline arithmetic
6. Migration naming: `bun run db:generate -- --name <snake_case_name>` — never accept random drizzle-kit name
7. Tests: unit (pure functions), integration (in-memory bun:sqlite + raw DDL), E2E (Playwright)
8. Pre-commit hook runs lint-staged + jscpd + arch; every commit must pass

---

## File Structure

Additions on top of phase 1 + 2:

```
src/
├── domain/
│   ├── assessments/                    ← NEW MODULE
│   │   ├── index.ts                    barrel
│   │   ├── types.ts                    AuthorAssessmentInput + ratings Zod schema
│   │   ├── service.ts                  AuthorAssessmentService (create + update + list + findById)
│   │   ├── markdown.ts                 server-side markdown rendering + sanitization
│   │   └── divergence.ts               composite-vs-overall-inclusivity divergence helper
│   └── extraction/
│       └── prior-context.ts            ← UPDATED to also load author assessments
├── infrastructure/db/schema/
│   └── assessments.ts                  ← NEW: author_brand_assessments table
├── admin-ui/
│   ├── pages/
│   │   ├── brand-tabs/
│   │   │   └── assessments.tsx         ← REPLACES phase-1 placeholder
│   │   └── assessments-global.tsx      ← NEW: /admin/assessments cross-brand listing
│   ├── actions/
│   │   └── assessment.ts               ← NEW: POST/PUT routes; uses AuthorAssessmentService
│   └── components/
│       └── markdown-editor.tsx         ← NEW: textarea + live-preview pane (HTMX)
├── public-api/
│   └── assessments.ts                  ← NEW: GET /api/v1/brands/:slug/assessments
├── jobs/
│   └── score-brand.ts                  ← UPDATED: compute + persist divergence_flag
└── scripts/
    └── backfill-blog-assessments.ts    ← NEW: one-shot CLI

drizzle/
└── 0003_author_assessments.sql         ← NEW migration

tests/
├── unit/
│   ├── assessments/
│   │   ├── markdown.test.ts
│   │   └── divergence.test.ts
├── integration/
│   ├── assessments-schema.test.ts
│   ├── author-assessment-service.test.ts
│   ├── public-api-assessments.test.ts
│   ├── prior-context-with-assessments.test.ts
│   └── backfill-blog-assessments.test.ts
└── e2e/
    ├── assessment-create.spec.ts       ← REPLACES assessment-stub.spec.ts
    └── markdown-preview.spec.ts        ← BODY now real (was empty placeholder)
```

---

## Task Groups

- **Group A — Schema, service, markdown rendering** (Tasks 1–3)
- **Group B — Admin UI** (Tasks 4–7)
- **Group C — Calibration integration** (Tasks 8–9)
- **Group D — Public API** (Task 10)
- **Group E — Backfill CLI** (Tasks 11–12)
- **Group F — E2E + polish** (Tasks 13–14)

14 tasks total.

---

## Group A — Schema, service, markdown rendering

### Task 1: `author_brand_assessments` schema + migration

**Files:**
- Create: `src/infrastructure/db/schema/assessments.ts`
- Update: `src/infrastructure/db/schema/index.ts` (add `export * from "./assessments"`)
- Create: `tests/integration/assessments-schema.test.ts`
- Generate: `drizzle/0003_author_assessments.sql` (via `bun run db:generate -- --name author_assessments`)

- [ ] **Step 1: Write failing integration test**

`tests/integration/assessments-schema.test.ts`:

```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { brands } from "../../src/infrastructure/db/schema/brands";
import { authorBrandAssessments } from "../../src/infrastructure/db/schema/assessments";

describe("author_brand_assessments schema", () => {
  let db: ReturnType<typeof drizzle>;
  beforeEach(() => {
    const sqlite = new Database(":memory:");
    sqlite.run("PRAGMA foreign_keys = ON;");
    sqlite.run(`
      CREATE TABLE brands (
        id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        primary_url TEXT NOT NULL, category_tag TEXT NOT NULL DEFAULT 'running',
        audience_tags TEXT NOT NULL DEFAULT '[]', current_size_chart_version_id INTEGER,
        divergence_flag INTEGER NOT NULL DEFAULT 0, predicted_next_change_at TEXT,
        cadence_learned_at TEXT, observed_change_intervals TEXT,
        active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')), archived_at TEXT
      );
      CREATE TABLE author_brand_assessments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        author_slug TEXT NOT NULL,
        assessment_date TEXT NOT NULL DEFAULT (date('now')),
        ratings_json TEXT NOT NULL,
        prose_markdown TEXT NOT NULL DEFAULT '',
        origin TEXT NOT NULL CHECK (origin IN ('native','backfilled_from_blog_review')),
        source_review_url TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db = drizzle(sqlite);
  });

  test("inserts a native assessment with all 5 ratings", async () => {
    const [b] = await db.insert(brands).values({ slug: "x", name: "X", primaryUrl: "https://x.com" }).returning();
    if (!b) throw new Error("brand setup");
    const [a] = await db.insert(authorBrandAssessments).values({
      brandId: b.id,
      authorSlug: "drew",
      ratingsJson: {
        size_options: 7,
        tier_equity: 5,
        pricing_equity: 8,
        fit_label_honesty: 6,
        overall_inclusivity: 6.5,
      },
      proseMarkdown: "Some prose.",
      origin: "native",
    }).returning();
    expect(a?.origin).toBe("native");
    expect((a?.ratingsJson as { overall_inclusivity: number }).overall_inclusivity).toBe(6.5);
  });

  test("cascade-deletes when brand deleted", async () => {
    const [b] = await db.insert(brands).values({ slug: "x", name: "X", primaryUrl: "https://x.com" }).returning();
    if (!b) throw new Error("brand setup");
    await db.insert(authorBrandAssessments).values({
      brandId: b.id, authorSlug: "drew",
      ratingsJson: { size_options: 5, tier_equity: 5, pricing_equity: 5, fit_label_honesty: 5, overall_inclusivity: 5 },
      origin: "native",
    });
    await db.delete(brands).where(eq(brands.id, b.id));
    const remaining = await db.select().from(authorBrandAssessments);
    expect(remaining.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test, verify fail** (`bun test tests/integration/assessments-schema.test.ts`)

- [ ] **Step 3: Write `src/infrastructure/db/schema/assessments.ts`**

```typescript
import { sql } from "drizzle-orm";
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { brands } from "./brands";

export interface AssessmentRatings {
  size_options: number;
  tier_equity: number;
  pricing_equity: number;
  fit_label_honesty: number;
  overall_inclusivity: number;
}

export const authorBrandAssessments = sqliteTable("author_brand_assessments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  brandId: integer("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  authorSlug: text("author_slug").notNull(),
  assessmentDate: text("assessment_date").notNull().default(sql`(date('now'))`),
  ratingsJson: text("ratings_json", { mode: "json" }).$type<AssessmentRatings>().notNull(),
  proseMarkdown: text("prose_markdown").notNull().default(""),
  origin: text("origin", { enum: ["native", "backfilled_from_blog_review"] }).notNull(),
  sourceReviewUrl: text("source_review_url"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});
```

- [ ] **Step 4: Update schema barrel** (append `export * from "./assessments"`)

- [ ] **Step 5: Generate migration with meaningful name**

```bash
bun run db:generate -- --name author_assessments
```

Verify the generated file is `drizzle/0003_author_assessments.sql` (NOT a random name). If drizzle-kit ignores `--name` for some reason, manually rename and update `drizzle/meta/_journal.json` tag.

- [ ] **Step 6: Smoke test migration**

```bash
mkdir -p ./tmp
DATABASE_PATH=./tmp/p3.sqlite bun run db:migrate
sqlite3 ./tmp/p3.sqlite ".tables" | tr ' ' '\n' | sort | grep -E "author_brand_assessments|^$"
rm -f ./tmp/p3.sqlite*
```

- [ ] **Step 7: Run all gates + commit**

```bash
bun run typecheck && bun run lint && bun run arch && bun run test
git add src/infrastructure/db/schema/assessments.ts src/infrastructure/db/schema/index.ts drizzle/ tests/integration/assessments-schema.test.ts
git commit -m "feat: author_brand_assessments schema + migration"
```

---

### Task 2: AuthorAssessmentService

**Files:**
- Create: `src/domain/assessments/types.ts`, `src/domain/assessments/service.ts`, `src/domain/assessments/index.ts`
- Test: `tests/integration/author-assessment-service.test.ts`

- [ ] **Step 1: Write `src/domain/assessments/types.ts`**

```typescript
import { z } from "zod";

export const AssessmentRatingsSchema = z.object({
  size_options: z.number().min(0).max(10),
  tier_equity: z.number().min(0).max(10),
  pricing_equity: z.number().min(0).max(10),
  fit_label_honesty: z.number().min(0).max(10),
  overall_inclusivity: z.number().min(0).max(10),
});

export type AssessmentRatings = z.infer<typeof AssessmentRatingsSchema>;

export const NewAssessmentInputSchema = z.object({
  brandId: z.number().int().positive(),
  authorSlug: z.string().min(1).max(40),
  ratings: AssessmentRatingsSchema,
  proseMarkdown: z.string().default(""),
  origin: z.enum(["native", "backfilled_from_blog_review"]).default("native"),
  sourceReviewUrl: z.string().url().nullable().optional(),
  assessmentDate: z.string().optional(),
});

export type NewAssessmentInput = z.infer<typeof NewAssessmentInputSchema>;

export const UpdateAssessmentInputSchema = z.object({
  id: z.number().int().positive(),
  ratings: AssessmentRatingsSchema.optional(),
  proseMarkdown: z.string().optional(),
});

export type UpdateAssessmentInput = z.infer<typeof UpdateAssessmentInputSchema>;
```

- [ ] **Step 2: Write integration test for the service**

`tests/integration/author-assessment-service.test.ts`:

```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/infrastructure/db/schema";
import { brands } from "../../src/infrastructure/db/schema";
import { AuthorAssessmentService } from "../../src/domain/assessments";

function makeDb() {
  const sqlite = new Database(":memory:");
  sqlite.run("PRAGMA foreign_keys = ON;");
  sqlite.run(`
    CREATE TABLE brands (
      id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      primary_url TEXT NOT NULL, category_tag TEXT NOT NULL DEFAULT 'running',
      audience_tags TEXT NOT NULL DEFAULT '[]', current_size_chart_version_id INTEGER,
      divergence_flag INTEGER NOT NULL DEFAULT 0, predicted_next_change_at TEXT,
      cadence_learned_at TEXT, observed_change_intervals TEXT,
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), archived_at TEXT
    );
    CREATE TABLE author_brand_assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
      author_slug TEXT NOT NULL,
      assessment_date TEXT NOT NULL DEFAULT (date('now')),
      ratings_json TEXT NOT NULL,
      prose_markdown TEXT NOT NULL DEFAULT '',
      origin TEXT NOT NULL,
      source_review_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return drizzle(sqlite, { schema });
}

describe("AuthorAssessmentService", () => {
  let db: ReturnType<typeof makeDb>;
  let service: AuthorAssessmentService;
  let brandId: number;

  beforeEach(async () => {
    db = makeDb();
    service = new AuthorAssessmentService(db);
    const [b] = await db.insert(brands).values({ slug: "x", name: "X", primaryUrl: "https://x.com" }).returning();
    if (!b) throw new Error("brand setup");
    brandId = b.id;
  });

  const goodRatings = {
    size_options: 7, tier_equity: 5, pricing_equity: 8, fit_label_honesty: 6, overall_inclusivity: 6.5,
  };

  test("create inserts a new assessment with defaults", async () => {
    const id = await service.create({
      brandId, authorSlug: "drew", ratings: goodRatings,
    });
    const a = await service.findById(id);
    expect(a?.origin).toBe("native");
    expect(a?.proseMarkdown).toBe("");
  });

  test("create rejects out-of-range ratings", async () => {
    await expect(service.create({
      brandId, authorSlug: "drew",
      ratings: { ...goodRatings, size_options: 11 },
    })).rejects.toThrow();
  });

  test("update replaces ratings + prose, leaves other fields", async () => {
    const id = await service.create({
      brandId, authorSlug: "drew", ratings: goodRatings, proseMarkdown: "v1",
    });
    await service.update({ id, proseMarkdown: "v2" });
    const a = await service.findById(id);
    expect(a?.proseMarkdown).toBe("v2");
    expect((a?.ratingsJson as typeof goodRatings).size_options).toBe(7);
  });

  test("listForBrand returns all assessments sorted by assessment_date desc", async () => {
    await service.create({ brandId, authorSlug: "drew", ratings: goodRatings, assessmentDate: "2026-01-01" });
    await service.create({ brandId, authorSlug: "drew", ratings: goodRatings, assessmentDate: "2026-05-01" });
    const list = await service.listForBrand(brandId);
    expect(list.length).toBe(2);
    expect(list[0]?.assessmentDate).toBe("2026-05-01");
  });
});
```

- [ ] **Step 3: Run test, verify fail**

- [ ] **Step 4: Write `src/domain/assessments/service.ts`**

```typescript
import { desc, eq } from "drizzle-orm";
import type { DB } from "../../infrastructure/db";
import { authorBrandAssessments } from "../../infrastructure/db/schema";
import {
  NewAssessmentInputSchema,
  UpdateAssessmentInputSchema,
  type NewAssessmentInput,
  type UpdateAssessmentInput,
} from "./types";

export class AuthorAssessmentService {
  constructor(private readonly db: DB) {}

  async create(raw: unknown): Promise<number> {
    const input = NewAssessmentInputSchema.parse(raw);
    const insertValues: typeof authorBrandAssessments.$inferInsert = {
      brandId: input.brandId,
      authorSlug: input.authorSlug,
      ratingsJson: input.ratings,
      proseMarkdown: input.proseMarkdown,
      origin: input.origin,
    };
    if (input.assessmentDate !== undefined) insertValues.assessmentDate = input.assessmentDate;
    if (input.sourceReviewUrl !== undefined && input.sourceReviewUrl !== null) {
      insertValues.sourceReviewUrl = input.sourceReviewUrl;
    }
    const [row] = await this.db.insert(authorBrandAssessments).values(insertValues).returning({ id: authorBrandAssessments.id });
    if (!row) throw new Error("assessment insert returned empty");
    return row.id;
  }

  async update(raw: unknown): Promise<void> {
    const input = UpdateAssessmentInputSchema.parse(raw);
    const set: Partial<typeof authorBrandAssessments.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };
    if (input.ratings !== undefined) set.ratingsJson = input.ratings;
    if (input.proseMarkdown !== undefined) set.proseMarkdown = input.proseMarkdown;
    await this.db.update(authorBrandAssessments).set(set).where(eq(authorBrandAssessments.id, input.id));
  }

  async findById(id: number) {
    const [row] = await this.db.select().from(authorBrandAssessments).where(eq(authorBrandAssessments.id, id)).limit(1);
    return row ?? null;
  }

  async listForBrand(brandId: number) {
    return this.db.select().from(authorBrandAssessments)
      .where(eq(authorBrandAssessments.brandId, brandId))
      .orderBy(desc(authorBrandAssessments.assessmentDate));
  }

  async listAll() {
    return this.db.select().from(authorBrandAssessments)
      .orderBy(desc(authorBrandAssessments.assessmentDate));
  }
}
```

- [ ] **Step 5: Write `src/domain/assessments/index.ts`**

```typescript
export {
  AssessmentRatingsSchema,
  NewAssessmentInputSchema,
  UpdateAssessmentInputSchema,
  type AssessmentRatings,
  type NewAssessmentInput,
  type UpdateAssessmentInput,
} from "./types";
export { AuthorAssessmentService } from "./service";
```

- [ ] **Step 6: Verify gates + commit**

```bash
bun run typecheck && bun run lint && bun run arch && bun run test
git add src/domain/assessments/ tests/integration/author-assessment-service.test.ts
git commit -m "feat: AuthorAssessmentService with Zod-validated input"
```

---

### Task 3: Markdown rendering helper (server-side)

**Files:**
- Create: `src/domain/assessments/markdown.ts`
- Update: `src/domain/assessments/index.ts`
- Test: `tests/unit/assessments/markdown.test.ts`

- [ ] **Step 1: Install dependencies**

```bash
bun add marked sanitize-html
bun add -d @types/sanitize-html
```

- [ ] **Step 2: Write failing test**

`tests/unit/assessments/markdown.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { renderMarkdown } from "../../../src/domain/assessments/markdown";

describe("renderMarkdown", () => {
  test("renders basic markdown to HTML", () => {
    const html = renderMarkdown("# Hello\n\nSome **bold** text.");
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain("<strong>bold</strong>");
  });

  test("strips dangerous tags", () => {
    const html = renderMarkdown("<script>alert(1)</script>\n\nSafe text.");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Safe text.");
  });

  test("strips javascript: URLs in links", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  test("allows safe inline formatting (em, strong, code, links)", () => {
    const html = renderMarkdown("**bold** *em* `code` [link](https://example.com)");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>em</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('href="https://example.com"');
  });

  test("empty input returns empty string", () => {
    expect(renderMarkdown("")).toBe("");
  });
});
```

- [ ] **Step 3: Run test, verify fail**

- [ ] **Step 4: Write `src/domain/assessments/markdown.ts`**

```typescript
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = [
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "br", "hr",
  "strong", "em", "code", "pre",
  "a", "ul", "ol", "li", "blockquote",
];

const ALLOWED_ATTRIBUTES = {
  a: ["href", "title"],
};

const ALLOWED_SCHEMES = ["http", "https", "mailto"];

export function renderMarkdown(input: string): string {
  if (!input) return "";
  const raw = marked.parse(input, { async: false }) as string;
  return sanitizeHtml(raw, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ALLOWED_SCHEMES,
    disallowedTagsMode: "discard",
  });
}
```

- [ ] **Step 5: Update barrel**

```typescript
export { renderMarkdown } from "./markdown";
```

- [ ] **Step 6: Run gates + commit**

```bash
bun test tests/unit/assessments/markdown.test.ts
bun run typecheck && bun run lint && bun run arch
git add src/domain/assessments/markdown.ts src/domain/assessments/index.ts tests/unit/assessments/markdown.test.ts package.json bun.lock
git commit -m "feat: server-side markdown rendering with HTML sanitization"
```

---

## Group B — Admin UI

### Task 4: Assessments tab on brand detail page

**Files:**
- Create: `src/admin-ui/pages/brand-tabs/assessments.tsx`
- Update: `src/admin-ui/pages/brand-detail.tsx` (wire the tab — currently shows a phase-3 placeholder)
- Update: `src/admin-ui/index.ts` to pass `AuthorAssessmentService` into the page render context

- [ ] **Step 1: Write `src/admin-ui/pages/brand-tabs/assessments.tsx`**

```tsx
import { AuthorAssessmentService } from "../../../domain/assessments";
import { renderMarkdown } from "../../../domain/assessments";
import type { DB } from "../../../infrastructure/db";

const RATING_KEYS = [
  "size_options",
  "tier_equity",
  "pricing_equity",
  "fit_label_honesty",
  "overall_inclusivity",
] as const;

export async function AssessmentsTab(args: Readonly<{
  db: DB;
  brandId: number;
  brandSlug: string;
  authorSlug: string;
}>): Promise<string> {
  const service = new AuthorAssessmentService(args.db);
  const rows = await service.listForBrand(args.brandId);

  return (
    <div>
      <h3>Assessments</h3>
      <details>
        <summary role="button">Add new assessment</summary>
        <form method="post" action={`/admin/brands/${args.brandSlug}/assessments/create`}>
          <input type="hidden" name="authorSlug" value={args.authorSlug} />
          {RATING_KEYS.map((key) => (
            <label>
              {key.replaceAll("_", " ")} (0–10)
              <input
                type="number"
                name={`rating_${key}`}
                min="0"
                max="10"
                step="0.5"
                required
                value="5"
              />
            </label>
          ))}
          <label>
            Prose (markdown)
            <textarea
              name="proseMarkdown"
              rows={6}
              placeholder="Editorial commentary, optional…"
              hx-post={`/admin/brands/${args.brandSlug}/assessments/preview`}
              hx-trigger="input changed delay:300ms"
              hx-target="#assessment-prose-preview"
              hx-swap="innerHTML"
            />
          </label>
          <article id="assessment-prose-preview">
            <small>Preview appears here as you type.</small>
          </article>
          <button type="submit">Save assessment</button>
        </form>
      </details>

      {rows.length === 0 ? (
        <p>No assessments yet.</p>
      ) : (
        <table role="grid">
          <thead>
            <tr>
              <th>Date</th>
              <th>Author</th>
              <th>Composite (overall)</th>
              <th>Origin</th>
              <th>Prose</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr>
                <td>{row.assessmentDate}</td>
                <td>{row.authorSlug}</td>
                <td>{String(row.ratingsJson.overall_inclusivity)}</td>
                <td>{row.origin === "backfilled_from_blog_review" ? "blog backfill" : "native"}</td>
                <td>{renderMarkdown(row.proseMarkdown.slice(0, 200))}</td>
                <td>
                  <a href={`/admin/assessments/${String(row.id)}/edit`}>Edit</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update `src/admin-ui/pages/brand-detail.tsx`**

Replace the existing phase-3 placeholder branch for the `assessments` tab. Import `AssessmentsTab` and call it with the brand id, slug, and `authorSlug` (from the same args used elsewhere).

- [ ] **Step 3: Verify renders + commit**

```bash
bun run typecheck && bun run lint && bun run arch && bun run test
git add src/admin-ui/pages/brand-tabs/assessments.tsx src/admin-ui/pages/brand-detail.tsx
git commit -m "feat: assessments tab on brand detail (list + create form)"
```

---

### Task 5: Assessment action routes (create + preview + edit + update)

**Files:**
- Create: `src/admin-ui/actions/assessment.ts`
- Update: `src/admin-ui/index.ts` to mount it
- Test: integration test in `tests/integration/admin-assessment-actions.test.ts`

Per the dep-cruiser rule, this file MUST NOT import schema tables. It receives an `AuthorAssessmentService` instance via args.

- [ ] **Step 1: Write `src/admin-ui/actions/assessment.ts`**

```typescript
import { Elysia, type AnyElysia } from "elysia";
import { AuthorAssessmentService, renderMarkdown } from "../../domain/assessments";
import type { DB } from "../../infrastructure/db";
import { BrandService } from "../../domain/brands";

export function assessmentActions(args: Readonly<{ db: DB; authorSlug: string }>): AnyElysia {
  const assessments = new AuthorAssessmentService(args.db);
  const brands = new BrandService(args.db);

  return new Elysia()
    .post("/admin/brands/:slug/assessments/create", async ({ params, request, set }) => {
      const brand = await brands.findBySlug(params.slug);
      if (!brand) { set.status = 404; return ""; }
      const form = await request.formData();
      const proseMarkdown = String(form.get("proseMarkdown") ?? "");
      const ratings = {
        size_options: Number(form.get("rating_size_options") ?? 5),
        tier_equity: Number(form.get("rating_tier_equity") ?? 5),
        pricing_equity: Number(form.get("rating_pricing_equity") ?? 5),
        fit_label_honesty: Number(form.get("rating_fit_label_honesty") ?? 5),
        overall_inclusivity: Number(form.get("rating_overall_inclusivity") ?? 5),
      };
      try {
        await assessments.create({
          brandId: brand.id,
          authorSlug: args.authorSlug,
          ratings,
          proseMarkdown,
        });
      } catch (error) {
        set.status = 400;
        return `Invalid: ${(error as Error).message}`;
      }
      set.status = 302;
      set.headers.location = `/admin/brands/${params.slug}?tab=assessments`;
      return "";
    })
    .post("/admin/brands/:slug/assessments/preview", async ({ request }) => {
      const form = await request.formData();
      const md = String(form.get("proseMarkdown") ?? "");
      return new Response(renderMarkdown(md), { headers: { "content-type": "text/html" } });
    })
    .post("/admin/assessments/:id/update", async ({ params, request, set }) => {
      const id = Number(params.id);
      const form = await request.formData();
      const proseMarkdown = form.get("proseMarkdown") === null ? undefined : String(form.get("proseMarkdown"));
      const ratingKeys = [
        "size_options", "tier_equity", "pricing_equity", "fit_label_honesty", "overall_inclusivity",
      ] as const;
      const anyRating = ratingKeys.some((k) => form.get(`rating_${k}`) !== null);
      const ratings = anyRating ? {
        size_options: Number(form.get("rating_size_options") ?? 5),
        tier_equity: Number(form.get("rating_tier_equity") ?? 5),
        pricing_equity: Number(form.get("rating_pricing_equity") ?? 5),
        fit_label_honesty: Number(form.get("rating_fit_label_honesty") ?? 5),
        overall_inclusivity: Number(form.get("rating_overall_inclusivity") ?? 5),
      } : undefined;
      try {
        const updateInput: { id: number; proseMarkdown?: string; ratings?: typeof ratings } = { id };
        if (proseMarkdown !== undefined) updateInput.proseMarkdown = proseMarkdown;
        if (ratings !== undefined) updateInput.ratings = ratings;
        await assessments.update(updateInput);
      } catch (error) {
        set.status = 400;
        return `Invalid: ${(error as Error).message}`;
      }
      set.status = 302;
      set.headers.location = request.headers.get("referer") ?? "/admin/assessments";
      return "";
    });
}
```

- [ ] **Step 2: Mount in `src/admin-ui/index.ts`** alongside existing action plugins.

- [ ] **Step 3: Integration test**

`tests/integration/admin-assessment-actions.test.ts` — exercises POST create, POST preview, POST update endpoints with in-memory DB. Verifies redirects, validation errors, and that the preview endpoint returns sanitized HTML.

- [ ] **Step 4: Run gates + commit**

```bash
bun run typecheck && bun run lint && bun run arch && bun run test
git add src/admin-ui/actions/assessment.ts src/admin-ui/index.ts tests/integration/admin-assessment-actions.test.ts
git commit -m "feat: assessment action routes (create + preview + update)"
```

---

### Task 6: Edit page for individual assessments

**Files:**
- Create: `src/admin-ui/pages/assessment-edit.tsx`
- Update: `src/admin-ui/index.ts` to mount the GET /admin/assessments/:id/edit route

- [ ] **Step 1: Write `src/admin-ui/pages/assessment-edit.tsx`**

Renders a form pre-populated with the assessment's current values (ratings sliders, prose textarea). The form POSTs to `/admin/assessments/:id/update`. The textarea has the same HTMX preview wiring as the create form. Add a link back to the brand detail's assessments tab.

- [ ] **Step 2: Add the GET route to admin-ui composition**

```typescript
.get("/admin/assessments/:id/edit", async ({ params, set }) => {
  const id = Number(params.id);
  // ... use service to load, render the page or 404
})
```

- [ ] **Step 3: Run gates + commit**

```bash
git add src/admin-ui/pages/assessment-edit.tsx src/admin-ui/index.ts
git commit -m "feat: edit page for individual assessments"
```

---

### Task 7: Global /admin/assessments page

**Files:**
- Create: `src/admin-ui/pages/assessments-global.tsx`
- Update: `src/admin-ui/index.ts` and `src/admin-ui/components/nav.tsx` (add nav item)

- [ ] **Step 1: Write `src/admin-ui/pages/assessments-global.tsx`**

Shows all assessments across all brands in a sortable/filterable table. Columns: brand (linkable to /admin/brands/:slug?tab=assessments), date, author, overall composite, origin, prose preview, edit link.

- [ ] **Step 2: Add nav item to `src/admin-ui/components/nav.tsx`**

Add `["/admin/assessments", "Assessments"]` to the items list.

- [ ] **Step 3: Mount the GET route**

- [ ] **Step 4: Run gates + commit**

```bash
git add src/admin-ui/pages/assessments-global.tsx src/admin-ui/index.ts src/admin-ui/components/nav.tsx
git commit -m "feat: global /admin/assessments page"
```

---

## Group C — Calibration integration

### Task 8: Update prior-context to include author assessments

**Files:**
- Update: `src/domain/extraction/prior-context.ts`
- Update: `src/domain/extraction/extractor-claude.ts` (system prompt + buildUserText to use assessments as calibration anchor)
- Test: `tests/integration/prior-context-with-assessments.test.ts`

- [ ] **Step 1: Update `prior-context.ts` to also load assessments**

```typescript
import { desc, eq } from "drizzle-orm";
import type { DB } from "../../infrastructure/db";
import { brandSizeChartVersions, authorBrandAssessments } from "../../infrastructure/db/schema";
import type { CanonicalSizeChart } from "./canonical";
import type { PriorContext } from "./extractor-claude";

export async function assemblePriorContext(db: DB, brandId: number): Promise<PriorContext> {
  const [latest] = await db
    .select()
    .from(brandSizeChartVersions)
    .where(/* same as before */)
    .limit(1);
  const lastAccepted = (latest?.sizeChartJson as CanonicalSizeChart | undefined) ?? null;

  const assessmentRows = await db
    .select()
    .from(authorBrandAssessments)
    .where(eq(authorBrandAssessments.brandId, brandId))
    .orderBy(desc(authorBrandAssessments.assessmentDate))
    .limit(5);

  const assessments = assessmentRows.map((row) => ({
    authorSlug: row.authorSlug,
    assessmentDate: row.assessmentDate,
    ratings: row.ratingsJson,
    proseMarkdown: row.proseMarkdown,
  }));

  return { lastAccepted, assessments, corrections: [] };
}
```

- [ ] **Step 2: Update extractor-claude.ts to include assessments in calibration anchor section**

The existing `buildUserText` may already accept assessments — verify the `PriorContext` shape and ensure the prompt formats assessments helpfully. The system prompt's calibration anchors paragraph should reference author ratings as a sanity-check signal:

> Author assessments are editorial 0–10 ratings on dimensions like size_options, tier_equity, pricing_equity, fit_label_honesty, overall_inclusivity. Use these as sanity anchors — if your extracted chart implies a very different size_options story than what authors have rated, lower your confidence and explain why in what_i_saw.

- [ ] **Step 3: Integration test**

Seed a brand with assessments + a prior accepted size chart. Call `assemblePriorContext` and verify the returned shape includes both. Verify `buildUserText` (or equivalent) embeds them.

- [ ] **Step 4: Run gates + commit**

```bash
git add src/domain/extraction/prior-context.ts src/domain/extraction/extractor-claude.ts tests/integration/prior-context-with-assessments.test.ts
git commit -m "feat: assessments feed Claude extraction as calibration anchors"
```

---

### Task 9: Divergence flag in score-brand + brand detail surfacing

**Files:**
- Create: `src/domain/assessments/divergence.ts`
- Update: `src/domain/assessments/index.ts`
- Update: `src/jobs/score-brand.ts` to compute + persist divergence_flag
- Update: `src/admin-ui/pages/brand-detail.tsx` to surface divergence flag prominently
- Test: `tests/unit/assessments/divergence.test.ts`

- [ ] **Step 1: Write `src/domain/assessments/divergence.ts`**

```typescript
import type { AssessmentRatings } from "./types";
import { DIVERGENCE_FLAG_THRESHOLD } from "../scoring";

export interface DivergenceInput {
  composite: number | null;
  assessmentRatings: AssessmentRatings[];
}

export function computeDivergence(input: DivergenceInput): { divergent: boolean; gap: number | null } {
  if (input.composite === null || input.assessmentRatings.length === 0) {
    return { divergent: false, gap: null };
  }
  const meanOverall = input.assessmentRatings.reduce((s, r) => s + r.overall_inclusivity, 0) / input.assessmentRatings.length;
  const gap = Math.abs(input.composite - meanOverall);
  return { divergent: gap > DIVERGENCE_FLAG_THRESHOLD, gap };
}
```

- [ ] **Step 2: Write unit test** covering: divergence true when gap > threshold; false when within; null when no assessments or null composite.

- [ ] **Step 3: Update `score-brand.ts`**

After the `promoteSnapshotIfWarranted` call inside the transaction, load assessments and compute divergence. Update `brands.divergence_flag`. Still in the same transaction so the brand's flag reflects this scoring run consistently.

```typescript
import { computeDivergence } from "../domain/assessments";
import { brands as brandsTable, authorBrandAssessments } from "../infrastructure/db/schema";
// inside the tx:
const assessments = await tx
  .select({ ratingsJson: authorBrandAssessments.ratingsJson })
  .from(authorBrandAssessments)
  .where(eq(authorBrandAssessments.brandId, brandId));
const divergence = computeDivergence({
  composite,
  assessmentRatings: assessments.map((a) => a.ratingsJson),
});
await tx.update(brandsTable).set({ divergenceFlag: divergence.divergent }).where(eq(brandsTable.id, brandId));
```

- [ ] **Step 4: Update brand detail overview tab**

In `src/admin-ui/pages/brand-tabs/overview.tsx`, surface the divergence flag with a visible badge when set. Show the gap value if available.

- [ ] **Step 5: Run gates + commit**

```bash
git add src/domain/assessments/divergence.ts src/domain/assessments/index.ts src/jobs/score-brand.ts src/admin-ui/pages/brand-tabs/overview.tsx tests/unit/assessments/divergence.test.ts
git commit -m "feat: divergence flag (computed vs author scores) + admin surfacing"
```

---

## Group D — Public API

### Task 10: GET /api/v1/brands/:slug/assessments

**Files:**
- Create: `src/public-api/assessments.ts`
- Update: `src/public-api/index.ts`
- Test: `tests/integration/public-api-assessments.test.ts`

- [ ] **Step 1: Write `src/public-api/assessments.ts`**

```typescript
import { Elysia, type AnyElysia } from "elysia";
import type { DB } from "../infrastructure/db";
import { AuthorAssessmentService, renderMarkdown } from "../domain/assessments";
import { lookupBrand } from "./response-helpers";
import { jsonWithCaching } from "./response-helpers";
import { problemDetailsResponse, ProblemTypes } from "../infrastructure/http";

export function assessmentsRoute(args: Readonly<{ db: DB }>): AnyElysia {
  return new Elysia().get("/api/v1/brands/:slug/assessments", async ({ params, request }) => {
    const brand = await lookupBrand(args.db, params.slug);
    if (!brand) {
      return problemDetailsResponse({
        type: ProblemTypes.NotFound,
        title: "Not Found",
        status: 404,
        detail: `No brand with slug ${params.slug}`,
      });
    }
    const service = new AuthorAssessmentService(args.db);
    const rows = await service.listForBrand(brand.id);
    const body = JSON.stringify({
      slug: brand.slug,
      count: rows.length,
      assessments: rows.map((r) => ({
        authorSlug: r.authorSlug,
        assessmentDate: r.assessmentDate,
        ratings: r.ratingsJson,
        proseMarkdown: r.proseMarkdown,
        proseHtml: renderMarkdown(r.proseMarkdown),
        origin: r.origin,
        sourceReviewUrl: r.sourceReviewUrl,
      })),
    });
    return jsonWithCaching(body, request);
  });
}
```

- [ ] **Step 2: Register in `src/public-api/index.ts`**

- [ ] **Step 3: Integration test** covering: 404 for unknown slug, empty for brand with no assessments, returns list with prose-html for brand with assessments, ETag 304 on If-None-Match.

- [ ] **Step 4: Run gates + commit**

```bash
git add src/public-api/assessments.ts src/public-api/index.ts tests/integration/public-api-assessments.test.ts
git commit -m "feat: public API /brands/:slug/assessments endpoint"
```

---

## Group E — Backfill CLI

### Task 11: Blog review parser

**Files:**
- Create: `src/domain/assessments/blog-parser.ts`
- Update: `src/domain/assessments/index.ts`
- Test: `tests/unit/assessments/blog-parser.test.ts` (with fixture files in `tests/fixtures/blog-reviews/`)

This parses MDX/Markdown review files from the biglongrun.com Astro blog and extracts the brand-level subjective data we want to backfill: `sizeOptions.rating`, `sizeOptions.summary`, brand reference, author, review URL, date.

The blog's review schema is documented in `docs/superpowers/specs/2026-05-16-brand-scan-design.md` section 13 + the original GitHub issue reference. Key fields in YAML frontmatter:

```yaml
---
brand: "Tracksmith"
date: 2025-08-12
author: "drew"
sizeReviewed: "M"
sizeOptions:
  rating: 4
  summary: "Tracksmith offers extended sizes inconsistently…"
---
```

- [ ] **Step 1: Write blog-parser**

```typescript
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface BlogReviewParsed {
  brand: string;
  date: string;
  author: string;
  reviewUrl: string | null;
  sizeOptionsRating: number | null;
  sizeOptionsSummary: string;
}

const FRONTMATTER_DELIMITER = /^---\r?\n/;
const FRONTMATTER_END = /\r?\n---\r?\n/;

function extractFrontmatter(raw: string): Record<string, unknown> | null {
  if (!FRONTMATTER_DELIMITER.test(raw)) return null;
  const rest = raw.replace(FRONTMATTER_DELIMITER, "");
  const endMatch = FRONTMATTER_END.exec(rest);
  if (!endMatch) return null;
  const yaml = rest.slice(0, endMatch.index);
  // Minimal YAML parser — only handles the shapes we expect (top-level strings/numbers + nested sizeOptions block).
  // For full safety we could pull in a YAML lib, but for the known blog schema this is fine.
  return parseSimpleYaml(yaml);
}

function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = yaml.split(/\r?\n/);
  let currentNestedKey: string | null = null;
  const nested: Record<string, Record<string, unknown>> = {};
  for (const line of lines) {
    if (!line.trim() || line.startsWith("#")) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (indent === 0) {
      currentNestedKey = null;
      const [key, ...rest] = line.split(":");
      if (!key) continue;
      const value = rest.join(":").trim();
      if (value === "") {
        currentNestedKey = key.trim();
        nested[currentNestedKey] = {};
      } else {
        out[key.trim()] = stripQuotes(value);
      }
    } else if (currentNestedKey) {
      const [key, ...rest] = line.trim().split(":");
      if (!key) continue;
      const value = rest.join(":").trim();
      nested[currentNestedKey]![key.trim()] = stripQuotes(value);
    }
  }
  for (const [k, v] of Object.entries(nested)) out[k] = v;
  return out;
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

export async function parseBlogReviewsDir(reviewsDirAbsPath: string): Promise<BlogReviewParsed[]> {
  const entries = await readdir(reviewsDirAbsPath, { recursive: true, withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && (e.name.endsWith(".mdx") || e.name.endsWith(".md")));
  const parsed: BlogReviewParsed[] = [];
  for (const file of files) {
    const fullPath = join(file.parentPath ?? reviewsDirAbsPath, file.name);
    const raw = await readFile(fullPath, "utf8");
    const fm = extractFrontmatter(raw);
    if (!fm) continue;
    const brand = typeof fm.brand === "string" ? fm.brand : null;
    if (!brand) continue;
    const sizeOpts = fm.sizeOptions as Record<string, unknown> | undefined;
    const rating = sizeOpts && typeof sizeOpts.rating === "string" ? Number.parseFloat(sizeOpts.rating) : null;
    const summary = sizeOpts && typeof sizeOpts.summary === "string" ? sizeOpts.summary : "";
    parsed.push({
      brand,
      date: typeof fm.date === "string" ? fm.date : "1970-01-01",
      author: typeof fm.author === "string" ? fm.author : "unknown",
      reviewUrl: typeof fm.url === "string" ? fm.url : null,
      sizeOptionsRating: rating !== null && Number.isFinite(rating) ? rating : null,
      sizeOptionsSummary: summary,
    });
  }
  return parsed;
}
```

- [ ] **Step 2: Add fixture files in `tests/fixtures/blog-reviews/`**

Create 2-3 sample .mdx files with realistic frontmatter representing different brands.

- [ ] **Step 3: Unit test** covering: parses frontmatter; skips files without `brand:`; handles nested `sizeOptions:`; recurses subdirectories.

- [ ] **Step 4: Commit**

```bash
git add src/domain/assessments/blog-parser.ts src/domain/assessments/index.ts tests/unit/assessments/blog-parser.test.ts tests/fixtures/blog-reviews/
git commit -m "feat: blog review frontmatter parser"
```

---

### Task 12: backfill-blog-assessments CLI

**Files:**
- Create: `scripts/backfill-blog-assessments.ts`
- Update: `package.json` (add `backfill-blog-assessments` script)
- Test: `tests/integration/backfill-blog-assessments.test.ts`

- [ ] **Step 1: Write the CLI script**

```typescript
import { parseArgs } from "node:util";
import { runMigrations } from "../src/infrastructure/db/migrate";
import { getDb } from "../src/infrastructure/db";
import { AuthorAssessmentService, parseBlogReviewsDir } from "../src/domain/assessments";
import { BrandService } from "../src/domain/brands";

const { values } = parseArgs({
  options: {
    "blog-repo": { type: "string", short: "b" },
    "reviews-dir": { type: "string", short: "r" },
    "dry-run": { type: "boolean", default: false },
  },
});

const blogRepo = values["blog-repo"];
if (!blogRepo) {
  console.error("usage: bun run backfill-blog-assessments --blog-repo <path> [--reviews-dir <relative-path>] [--dry-run]");
  process.exit(1);
}
const reviewsDir = values["reviews-dir"] ?? "src/content/reviews";
const fullReviewsPath = `${blogRepo.replace(/\/$/, "")}/${reviewsDir.replace(/^\//, "")}`;

runMigrations();
const db = getDb();
const brands = new BrandService(db);
const assessments = new AuthorAssessmentService(db);

const parsed = await parseBlogReviewsDir(fullReviewsPath);
console.log(`Parsed ${String(parsed.length)} reviews from ${fullReviewsPath}`);

let created = 0;
let skipped = 0;
for (const review of parsed) {
  if (review.sizeOptionsRating === null) {
    skipped++;
    continue;
  }
  const slug = brandSlugFromName(review.brand);
  const brand = await brands.findBySlug(slug);
  if (!brand) {
    console.warn(`Brand not found in brand-scan: ${review.brand} (slug ${slug}) — skipping`);
    skipped++;
    continue;
  }
  if (values["dry-run"]) {
    console.log(`[dry-run] Would create assessment for ${review.brand} (${review.date}): size_options=${String(review.sizeOptionsRating)}`);
    created++;
    continue;
  }
  await assessments.create({
    brandId: brand.id,
    authorSlug: review.author,
    ratings: {
      size_options: review.sizeOptionsRating,
      tier_equity: 5,
      pricing_equity: 5,
      fit_label_honesty: 5,
      overall_inclusivity: review.sizeOptionsRating,
    },
    proseMarkdown: review.sizeOptionsSummary,
    origin: "backfilled_from_blog_review",
    sourceReviewUrl: review.reviewUrl,
    assessmentDate: review.date,
  });
  created++;
}

console.log(`${values["dry-run"] ? "[dry-run] " : ""}Created ${String(created)}, skipped ${String(skipped)}`);
```

Note: import `brandSlugFromName` from `src/domain/brands/slug` so the lookup uses the same slug rules as creation.

- [ ] **Step 2: Add script to package.json**

```json
"backfill-blog-assessments": "bun run scripts/backfill-blog-assessments.ts"
```

- [ ] **Step 3: Integration test using fixture blog dir + a temp SQLite**

- [ ] **Step 4: Run gates + commit**

```bash
git add scripts/backfill-blog-assessments.ts package.json tests/integration/backfill-blog-assessments.test.ts
git commit -m "feat: backfill-blog-assessments CLI"
```

---

## Group F — E2E + polish

### Task 13: Replace phase-3 E2E placeholders with real tests

**Files:**
- Replace: `tests/e2e/assessment-stub.spec.ts` (or `tier-override.spec.ts` if it covers the placeholder) → `tests/e2e/assessment-create.spec.ts`
- Update: `tests/e2e/markdown-preview.spec.ts` (body)

Phase-1 created two `test.skip(...)` placeholders. Replace with real flows:

**`assessment-create.spec.ts`:** login → navigate to a brand → assessments tab → expand "Add new assessment" → fill 5 rating sliders → fill prose textarea → submit → verify the assessment row appears in the table.

**`markdown-preview.spec.ts`:** login → navigate to a brand's assessments tab → type markdown into the textarea → verify the preview pane (`#assessment-prose-preview`) updates with rendered HTML within ~500ms (HTMX debounce + render).

Keep tests resilient — graceful skip if no brand is seeded.

- [ ] **Step 1: Update tests/e2e/server.ts** if needed to ensure a brand exists at startup. (Phase-2's tier-override test seeded one already; verify it still seeds.)

- [ ] **Step 2: Write the two E2E tests**

- [ ] **Step 3: Run `bun run test:e2e`** locally if Chromium is installed; otherwise let CI verify.

- [ ] **Step 4: Run gates + commit**

```bash
bun run typecheck && bun run lint && bun run arch && bun run test
git add tests/e2e/
git commit -m "test: real E2E for assessment create + markdown preview (replace phase-3 placeholders)"
```

---

### Task 14: README + phase-3-complete tag

**Files:**
- Update: `README.md` to reflect assessments are now part of the system (no phase labels — comprehensive view, per the convention)
- Tag: `phase-3-complete`

- [ ] **Step 1: Update README**

Add references to the new functionality without "Phase 3" labels:
- In "How it works", add a section on Author assessments (5 fixed dimensions + prose, used as calibration anchors during extraction)
- In "Service surface" → admin UI, replace the placeholder mention of Assessments tab with the real description
- In "Service surface" → public API, add `GET /api/v1/brands/:slug/assessments`
- In "Operations", add a note about the `bun run backfill-blog-assessments --blog-repo <path>` one-shot
- In "How it works" → "Scoring", note the divergence flag (computed composite vs author overall_inclusivity)

- [ ] **Step 2: Final verification**

```bash
bun run typecheck && bun run lint && bun run arch && bun run format && bun run test && bun run test:e2e
```

All must pass.

- [ ] **Step 3: Commit + tag**

```bash
git add README.md
git commit -m "docs: update README with assessments + calibration + backfill CLI"
git tag -a phase-3-complete -m "Phase 3: author assessments + calibration + divergence + backfill CLI"
```

---

## Self-Review

After all 14 tasks land, verify:

- [ ] Migration `drizzle/0003_author_assessments.sql` exists with meaningful name
- [ ] `AuthorAssessmentService` covers all CRUD operations with Zod validation
- [ ] Markdown rendering goes through `sanitize-html` — no XSS vector reaches the public API
- [ ] dep-cruiser: `src/admin-ui/actions/assessment.ts` does NOT import schema tables
- [ ] Prior-context now loads assessments; extractor prompt references them as calibration anchors
- [ ] score-brand computes divergence inside the existing transaction; `brands.divergence_flag` reflects current state
- [ ] Public API `/brands/:slug/assessments` works with bearer auth, ETag caching
- [ ] CLI backfill script handles missing brands gracefully and supports `--dry-run`
- [ ] E2E tests cover assessment creation and markdown preview
- [ ] README reads as comprehensive (no phase labels)
- [ ] Tag `phase-3-complete` set at the latest commit

## Spec coverage check

| Scope item | Tasks |
|---|---|
| Author brand assessments CRUD (5 fixed dimensions + markdown editor) | 1, 2, 3, 4, 5, 6, 7 |
| One-shot backfill CLI | 11, 12 |
| Public API `/brands/:slug/assessments` | 10 |
| AI extraction prompt enriched with author assessments | 8 |
| Divergence flag in admin | 9 |

## Execution choice

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — same flow as phases 1 + 2. Bundle by group.
2. **Inline Execution** — via `superpowers:executing-plans`.

**Branch strategy:** new worktree on `phase-3` from `main` (phase-1 + phase-2 are merged).
