# brand-scan — Agent Conventions

This file documents conventions for AI agents (and humans) working in this repo. The codebase is built with strict TypeScript + ESLint + dependency-cruiser; if you fight a rule, the rule is probably right.

## Transactional integrity

ANY operation that writes to more than one row across more than one statement MUST be wrapped in a SQLite transaction:

```typescript
await args.db.transaction(async (tx) => {
  await tx.update(brandSizeChartVersions).set(...).where(...);
  await tx.update(brands).set(...).where(...);
});
```

Rationale: SQLite is single-writer but a partial-failure between statements leaves the database in an inconsistent state (e.g., version marked accepted but brand pointer stale).

**Inside a transaction, do NOT:**

- Make network calls (Anthropic, Firecrawl, Pushover) — they hold the writer lock open
- Use `setTimeout` / `await new Promise(...)` for non-DB reasons
- Catch errors and continue — re-throw to abort the txn

**Outside the transaction:**

- Notifications (Pushover) — fire after the tx commits
- Job enqueues — usually after the tx commits (so consumers see the committed state)

When refactoring a function called from inside a transaction, accept the `tx` as a parameter and call it like `tx.update(...)` not `db.update(...)`.

## Repository pattern vs direct DB selects

We use repos (`BrandRepo`, `BrandSourceRepo`, etc. in `src/domain/<area>/repo.ts`) for:

- All writes (so input is validated via Zod schemas)
- Common reads with shared behavior (`findBySlug`, `list`)

We use direct `db.select(...)` in admin pages and one-off queries for:

- Page-specific cross-table joins (no reuse value in repo)
- Read-only display queries that don't benefit from an abstraction layer

If you find yourself writing the SAME read query in 2+ places, promote it to the repo.

## Type derivation from schema

Prefer Drizzle's inferred types over hand-rolled ones:

```typescript
import { brands } from "./infrastructure/db/schema";
type Brand = typeof brands.$inferSelect;
type NewBrand = typeof brands.$inferInsert;
```

This keeps types in sync with schema as it evolves.

## Migration naming

When generating a new migration, ALWAYS use a meaningful name:

```bash
bun run db:generate -- --name <name_in_snake_case>
```

Examples: `add_items_tables`, `backfill_score_history`, `add_brand_audience_tags`.

Never accept drizzle-kit's random default name (e.g., `cloudy_lady_vermin`). After generation, the filename should be `drizzle/<NNNN>_<your_name>.sql`. Update `drizzle/meta/_journal.json`'s `tag` field if needed.

## System-prompt engineering

When writing prompts for the LLM, explain ALL domain-specific fields in the output schema, even ones that seem self-explanatory. Models extract better when they understand WHY a field exists, not just its type.

Bad:

> Output keys: name, category, sizes.

Good:

> Output keys:
>
> - name: product display name
> - category: apparel category — tops, bottoms, shorts, outerwear
> - sizes: sizes the brand ACTUALLY OFFERS for this product (NOT the master size chart; some brands list 2XL on the chart but don't stock it for jackets).

## External service pricing

LLM and API pricing lives in the client module (e.g., `src/infrastructure/external/anthropic.ts`'s `estimateAnthropicCost`). NEVER inline cost calculations elsewhere — they drift when pricing changes.

## Quality gates

Every commit must pass:

- `bun run typecheck` — strict TS
- `bun run lint` — ESLint type-checked + unicorn + sonarjs
- `bun run arch` — dependency-cruiser module boundaries
- `bun run format` — Prettier check
- `bun run test` — unit + integration
- Pre-commit hook runs lint-staged + jscpd + arch

If you can't satisfy a rule, push back on it explicitly — don't disable it silently.
