import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
import { getEnv } from "../../env";

export type DB = BunSQLiteDatabase<typeof schema>;

let sqlite: Database | null = null;
let _db: DB | null = null;

export function getDb(): DB {
  if (!_db) {
    sqlite = new Database(getEnv().DATABASE_PATH, { create: true });
    sqlite.run("PRAGMA journal_mode = WAL;");
    sqlite.run("PRAGMA foreign_keys = ON;");
    sqlite.run("PRAGMA synchronous = NORMAL;");
    _db = drizzle(sqlite, { schema });
  }
  return _db;
}

export function closeDb(): void {
  sqlite?.close();
  sqlite = null;
  _db = null;
}
