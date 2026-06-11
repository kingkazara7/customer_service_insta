import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// Dev: SQLite single file. Prod (RDS): swap this module for the pg adapter —
// all SQL lives in the MCP servers and stays ANSI-compatible.
const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = process.env.DB_PATH ?? path.join(DATA_DIR, "partselect.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
  }
  return db;
}

export function initSchema(): void {
  const schema = fs.readFileSync(
    path.join(process.cwd(), "src", "server", "db", "schema.sql"),
    "utf8"
  );
  getDb().exec(schema);
}
