/** Print current row counts for documentation */
import { getDb } from "../src/server/db/connection";

const db = getDb();
const tables = [
  "appliance_models", "parts", "compatibility", "install_guides",
  "doc_chunks", "users", "user_appliances", "search_history",
  "carts", "orders", "order_items",
];
for (const t of tables) {
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number };
  console.log(`${t}: ${n}`);
}
const { e } = db.prepare("SELECT COUNT(*) AS e FROM doc_chunks WHERE embedding IS NOT NULL").get() as { e: number };
console.log(`doc_chunks with embeddings: ${e}`);
const { z } = db.prepare("SELECT COUNT(*) AS z FROM parts WHERE stock_qty = 0").get() as { z: number };
console.log(`zero-stock demo parts: ${z}`);
