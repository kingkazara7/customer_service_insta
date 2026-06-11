/**
 * Async database driver with two interchangeable backends, selected by DB_DRIVER:
 *   - "sqlite" (default): better-sqlite3, a single file — dev and embedded use
 *   - "pg": node-postgres against RDS PostgreSQL — production
 *
 * The whole app talks to this interface (never to a backend directly), so the
 * service layer stays dialect-neutral. Two rules keep the SQL portable:
 *   • placeholders are always "?" (the pg backend rewrites them to $1, $2, …)
 *   • inserts that need the new id use "... RETURNING id" via get()
 *
 * Case-insensitive lookups use LOWER(col) = LOWER(?) (works in both), and
 * upserts use ANSI "ON CONFLICT", supported by modern SQLite and Postgres.
 */

export interface Db {
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  exec(sql: string, params?: unknown[]): Promise<void>;
  /** Run raw multi-statement DDL (schema). */
  execScript(sql: string): Promise<void>;
  /** Run fn inside a transaction; commits on success, rolls back on throw. */
  tx<T>(fn: (t: Db) => Promise<T>): Promise<T>;
}

export const DRIVER = process.env.DB_DRIVER === "pg" ? "pg" : "sqlite";

// ── SQLite backend ──────────────────────────────────────────
import path from "node:path";
import fs from "node:fs";

type SqliteDb = import("better-sqlite3").Database;

function makeSqlite(): Db {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  const DB_PATH =
    process.env.DB_PATH ?? path.join(process.cwd(), "data", "partselect.db");
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const raw: SqliteDb = new Database(DB_PATH);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");

  const wrap = (conn: SqliteDb): Db => ({
    async all<T>(sql: string, params: unknown[] = []) {
      return conn.prepare(sql).all(...(params as never[])) as T[];
    },
    async get<T>(sql: string, params: unknown[] = []) {
      return conn.prepare(sql).get(...(params as never[])) as T | undefined;
    },
    async exec(sql: string, params: unknown[] = []) {
      conn.prepare(sql).run(...(params as never[]));
    },
    async execScript(sql: string) {
      conn.exec(sql);
    },
    // better-sqlite3 is synchronous, so a manual BEGIN/COMMIT spans the (sync) work
    async tx<T>(fn: (t: Db) => Promise<T>) {
      conn.exec("BEGIN");
      try {
        const r = await fn(wrap(conn));
        conn.exec("COMMIT");
        return r;
      } catch (e) {
        conn.exec("ROLLBACK");
        throw e;
      }
    },
  });
  return wrap(raw);
}

// ── Postgres backend ────────────────────────────────────────
// Rewrite "?" placeholders to "$1, $2, …" for node-postgres.
function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function makePg(): Db {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require("pg") as typeof import("pg");
  const pool = new Pool({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: process.env.PGSSL === "0" ? undefined : { rejectUnauthorized: false },
    max: 10,
  });

  type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };
  const wrap = (q: Queryable): Db => ({
    async all<T>(sql: string, params: unknown[] = []) {
      const r = await q.query(toPg(sql), params);
      return r.rows as T[];
    },
    async get<T>(sql: string, params: unknown[] = []) {
      const r = await q.query(toPg(sql), params);
      return (r.rows[0] as T) ?? undefined;
    },
    async exec(sql: string, params: unknown[] = []) {
      await q.query(toPg(sql), params);
    },
    async execScript(sql: string) {
      await q.query(sql);
    },
    async tx<T>(fn: (t: Db) => Promise<T>) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client: any = await (pool as any).connect();
      try {
        await client.query("BEGIN");
        const r = await fn(wrap(client));
        await client.query("COMMIT");
        return r;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
  });
  return wrap(pool as unknown as Queryable);
}

let instance: Db | null = null;
export function db(): Db {
  if (!instance) instance = DRIVER === "pg" ? makePg() : makeSqlite();
  return instance;
}
