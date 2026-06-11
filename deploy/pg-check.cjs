const { Pool } = require("pg");
const p = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false },
});
p.query("SELECT version()")
  .then((r) => { console.log("PG OK:", r.rows[0].version.slice(0, 50)); return p.end(); })
  .catch((e) => { console.log("PG FAIL:", e.message); process.exit(1); });
