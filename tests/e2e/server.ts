import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "../../src/infrastructure/db/schema";
import { brands, brandSources, brandItems } from "../../src/infrastructure/db/schema";
import { Queue } from "../../src/infrastructure/queue";
import { CircuitBreaker } from "../../src/domain/usage";
import { buildApp } from "../../src/server/app";

const tmp = mkdtempSync(nodePath.join(tmpdir(), "brand-scan-e2e-"));
const dbPath = nodePath.join(tmp, "e2e.sqlite");
const artifactsPath = nodePath.join(tmp, "artifacts");
mkdirSync(artifactsPath, { recursive: true });
const sqlite = new Database(dbPath, { create: true });
sqlite.run("PRAGMA journal_mode = WAL;");
sqlite.run("PRAGMA foreign_keys = ON;");
const db = drizzle(sqlite, { schema });
migrate(db, { migrationsFolder: "./drizzle" });

const adminPasswordHash = await Bun.password.hash("e2e-password");

// Seed one brand + source + item so tier-override E2E has data to operate on.
const [seededBrand] = await db
  .insert(brands)
  .values({
    slug: "e2e-brand",
    name: "E2E Brand",
    primaryUrl: "https://e2e.example.com",
    categoryTag: "running",
  })
  .returning();
if (seededBrand) {
  await db.insert(brandSources).values({
    brandId: seededBrand.id,
    url: "https://e2e.example.com/products.json",
    sourceType: "shopify_feed",
  });
  await db.insert(brandItems).values({
    brandId: seededBrand.id,
    sourceUrl: "https://e2e.example.com/products/e2e-jacket",
    name: "E2E Jacket",
    category: "outerwear",
    tierClassification: "unclassified",
    basePriceUsd: 99.99,
  });
}

const app = buildApp({
  db,
  queue: new Queue(db),
  bearerToken: "e2e-bearer",
  sessionSecret: "0".repeat(32),
  adminPasswordHash,
  authorSlug: "drew",
  artifactsLocalPath: artifactsPath,
  artifactsPublicBaseUrl: "/artifacts",
  circuitBreaker: new CircuitBreaker(db, { firecrawlMonthlyPages: 1000, anthropicMonthlyUsd: 10 }),
  bootedAt: new Date(),
});

app.listen(3001);
console.log("e2e server on 3001 with db:", dbPath);
