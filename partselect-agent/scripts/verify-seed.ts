import { getDb } from "../src/server/db/connection";

const db = getDb();
const p = db
  .prepare("SELECT part_no,name,price,stock_qty FROM parts WHERE part_no=?")
  .get("PS11752778");
console.log("PS11752778:", JSON.stringify(p));

const compat = db
  .prepare(
    `SELECT COUNT(*) AS n FROM compatibility c
     JOIN parts p ON p.id=c.part_id
     JOIN appliance_models m ON m.id=c.model_id
     WHERE p.part_no='PS11752778' AND m.model_no='WDT780SAEM1'`
  )
  .get();
console.log("PS11752778 fits WDT780SAEM1:", JSON.stringify(compat));

const fitting = db
  .prepare(
    `SELECT COUNT(*) AS n FROM compatibility c
     JOIN appliance_models m ON m.id=c.model_id
     WHERE m.model_no='WDT780SAEM1'`
  )
  .get();
console.log("parts fitting WDT780SAEM1:", JSON.stringify(fitting));

const outOfStock = db
  .prepare("SELECT part_no,name FROM parts WHERE stock_qty=0")
  .all();
console.log("out-of-stock demo parts:", JSON.stringify(outOfStock));
