import fs from "node:fs";
import path from "node:path";
import { db, DRIVER } from "./driver";

export { db } from "./driver";

/** Load the dialect-appropriate schema (schema.sql for SQLite, schema.pg.sql for Postgres). */
export async function initSchema(): Promise<void> {
  const file = DRIVER === "pg" ? "schema.pg.sql" : "schema.sql";
  const schema = fs.readFileSync(
    path.join(process.cwd(), "src", "server", "db", file),
    "utf8"
  );
  await db().execScript(schema);
}
