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
