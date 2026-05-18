import { parseArgs } from "node:util";
import { runMigrations } from "../src/infrastructure/db/migrate";
import { getDb } from "../src/infrastructure/db";
import { runBackfill } from "../src/domain/assessments/backfill";

const { values } = parseArgs({
  options: {
    "blog-repo": { type: "string" },
    "reviews-dir": { type: "string", default: "src/content/reviews" },
    "dry-run": { type: "boolean", default: false },
  },
  args: process.argv.slice(2),
  strict: true,
});

const blogRepo = values["blog-repo"];
if (!blogRepo) {
  console.error("Error: --blog-repo <path> is required");
  process.exit(1);
}

runMigrations();
const db = getDb();

// After the guard above TypeScript narrows blogRepo to string.
const reviewsDir = values["reviews-dir"];
const dryRun = values["dry-run"];

const summary = await runBackfill({
  db,
  blogRepo,
  reviewsDir,
  dryRun,
});

console.log(`Created ${String(summary.created)}, skipped ${String(summary.skipped)}`);
