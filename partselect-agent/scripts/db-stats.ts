/** Print current row counts for documentation */
import { db } from "../src/server/db/connection";

async function main() {
  const tables = [
    "appliance_models", "parts", "compatibility", "install_guides",
    "doc_chunks", "users", "user_appliances", "search_history",
    "carts", "orders", "order_items",
  ];
  for (const t of tables) {
    const r = await db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`);
    console.log(`${t}: ${r?.n}`);
  }
  const e = await db().get<{ e: number }>("SELECT COUNT(*) AS e FROM doc_chunks WHERE embedding IS NOT NULL");
  console.log(`doc_chunks with embeddings: ${e?.e}`);
  const z = await db().get<{ z: number }>("SELECT COUNT(*) AS z FROM parts WHERE stock_qty = 0");
  console.log(`zero-stock demo parts: ${z?.z}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
