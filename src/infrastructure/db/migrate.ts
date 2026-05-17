import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

const DEFAULT_PATH = "./tmp/brand-scan.sqlite";

export function runMigrations(databasePath?: string): void {
  const path = databasePath ?? process.env.DATABASE_PATH ?? DEFAULT_PATH;
  const sqlite = new Database(path, { create: true });
  sqlite.run("PRAGMA journal_mode = WAL;");
  sqlite.run("PRAGMA foreign_keys = ON;");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: "./drizzle" });
  sqlite.close();
}

if (import.meta.main) {
  runMigrations();
  console.log("Migrations applied.");
}
