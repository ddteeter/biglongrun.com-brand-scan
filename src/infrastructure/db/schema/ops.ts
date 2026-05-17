import { sql } from "drizzle-orm";
import { sqliteTable, integer, text, real, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobType: text("job_type").notNull(),
  payloadJson: text("payload_json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  dedupeKey: text("dedupe_key").notNull().unique(),
  status: text("status", {
    enum: ["pending", "running", "succeeded", "failed", "failed_dead"],
  }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  scheduledFor: text("scheduled_for")
    .notNull()
    .default(sql`(datetime('now'))`),
  pickedAt: text("picked_at"),
  heartbeatAt: text("heartbeat_at"),
  heartbeatIntervalSecs: integer("heartbeat_interval_secs"),
  finishedAt: text("finished_at"),
  errorJson: text("error_json", { mode: "json" }).$type<{ message: string; stack?: string }>(),
  runId: integer("run_id"),
});

export const runs = sqliteTable("runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id")
    .notNull()
    .references((): AnySQLiteColumn => jobs.id, { onDelete: "cascade" }),
  startedAt: text("started_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  finishedAt: text("finished_at"),
  status: text("status").notNull(),
  summaryJson: text("summary_json", { mode: "json" }).$type<Record<string, unknown>>(),
  costUsdEstimate: real("cost_usd_estimate"),
  firecrawlPagesUsed: integer("firecrawl_pages_used"),
});

export const runArtifacts = sqliteTable("run_artifacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["screenshot", "raw_html", "raw_claude_response"] }).notNull(),
  filePath: text("file_path").notNull(),
  bytes: integer("bytes").notNull(),
  sha256: text("sha256").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const apiUsageLog = sqliteTable("api_usage_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider", { enum: ["firecrawl", "anthropic", "pushover"] }).notNull(),
  runId: integer("run_id").references(() => runs.id, { onDelete: "set null" }),
  unitsUsed: real("units_used").notNull(),
  unitsKind: text("units_kind").notNull(),
  estimatedCostUsd: real("estimated_cost_usd").notNull(),
  occurredAt: text("occurred_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
