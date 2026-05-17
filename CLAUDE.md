# brand-scan — Agent Conventions

This file documents conventions for AI agents (and humans) working in this repo. The codebase is built with strict TypeScript + ESLint + dependency-cruiser; if you fight a rule, the rule is probably right.

## Transactional integrity

ANY operation that writes to more than one row across more than one statement MUST be wrapped in a SQLite transaction. Prefer placing transactions inside **service methods** (see "Service pattern" below) rather than inline in action handlers or orchestrators — services are where the invariants live.

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

## Service pattern (instead of repos)

We use **service** modules to encapsulate operations that have multi-table or multi-row invariants. Examples in the codebase:

- `BrandService` (`src/domain/brands/service.ts`) — slug generation invariant on brand creation
- `VersionService` (`src/domain/extraction/version-service.ts`) — "accept a version" invariant (insert + supersede prior + update brand pointer, all in one transaction)
- `BrandItemService` (phase 2, `src/domain/catalog/repo.ts` — to be renamed) — upsert + change-log invariant

**Rule:**

> Promote a multi-step DB operation to a service method WHEN it touches >1 table OR has invariants that span >1 row. Direct `db.select(...)` / `db.update(...)` is fine for single-row writes, read-only display queries, and operational-table access (jobs, runs, sessions, api_usage_log).
>
> If you find yourself writing the SAME multi-step write in 2+ places, promote it to a service.

**Enforcement:**

- `src/admin-ui/actions/**` is forbidden from importing schema tables (`src/infrastructure/db/schema/**`) — actions MUST call service methods. Enforced by `dependency-cruiser`.
- Other layers (jobs, pipeline orchestrators) can use `db` directly but should call services for multi-step writes.
- Code review: any new `db.transaction(...)` block in a non-service file is a smell.

**Why service, not repo:**

- TS/Drizzle culture is closer to "service" than "repo" — the ORM is already strongly typed and most of what Java repos provide over JDBC is built in
- Services name operations (verbs like `acceptVersion`) not tables (nouns) — fits how they're called
- Less abstraction tax: only build a service when there's actual orchestration value

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
