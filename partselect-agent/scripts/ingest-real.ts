/**
 * Ingest real PartSelect catalog data (harvested via a real browser session —
 * partselect.com returns 403 to plain HTTP scrapers) into the existing schema.
 *
 * This is the "ingestion contract" in action: the same tables the demo seed
 * fills are updated here with live data. Run AFTER db:seed:
 *   npm run db:seed && npm run ingest
 *
 * Behavior:
 *  - remap: invented seed part numbers whose mfr number matches a real part
 *    are renamed to the real PartSelect number IN PLACE (row id preserved, so
 *    order history and carts keep their foreign keys).
 *  - parts are upserted by part_no: real name/mfr/price/description/symptoms/url win.
 *  - compatibility links each harvested part to its source model.
 *  - install_guides are created/updated for detail-enriched parts (real
 *    difficulty, time, and YouTube video).
 */
import fs from "node:fs";
import path from "node:path";
import { db } from "../src/server/db/connection";

type ListingPart = {
  ps: string; mfr: string | null; name: string; price: number | string; stock: string | null; slug: string;
};
type Detail = {
  description: string; symptoms: string; difficulty: string;
  installTime: string; videoUrl: string; price?: number; slug?: string;
};
type Harvest = {
  harvestedAt: string;
  source: string;
  remap: Record<string, string>;
  models: { modelNo: string; type: "refrigerator" | "dishwasher"; brand: string; parts: ListingPart[] }[];
  details: Record<string, Detail>;
};

const DIFFICULTY: Record<string, string> = {
  "Really Easy": "easy", "Easy": "easy", "Average": "medium",
  "Difficult": "hard", "Very Difficult": "hard",
};

function minutes(installTime: string | undefined): number {
  if (!installTime) return 30;
  if (/Less than 15/i.test(installTime)) return 10;
  const m = installTime.match(/(\d+)\s*-\s*(\d+)/);
  if (m) return Math.round((Number(m[1]) + Number(m[2])) / 2);
  return 30;
}

function stockQty(stock: string | null, existing: number | undefined): number {
  if (stock === "In Stock") return existing && existing > 0 ? existing : 20;
  if (stock === "Special Order" || stock === "On Order") return 3;
  return 0;
}

/**
 * Invented seed parts whose manufacturer numbers turned out to belong to
 * different real parts. Safe to delete unless an order references them.
 */
const STALE_FAKES = ["PS11753783", "PS11770327"];

async function main() {
  const dir = path.join(process.cwd(), "data", "ingested");
  const harvest = JSON.parse(
    fs.readFileSync(path.join(dir, "real-parts.json"), "utf8")
  ) as Harvest;
  // Full model-parts harvest (5 models, ~800 parts) supersedes the listing
  // slice in real-parts.json; details/remap still come from the base file.
  const fullPath = path.join(dir, "real-parts-full.json");
  if (fs.existsSync(fullPath)) {
    const full = JSON.parse(fs.readFileSync(fullPath, "utf8")) as Pick<Harvest, "models">;
    harvest.models = full.models;
    console.log(`using full harvest: ${full.models.map((m) => `${m.modelNo}(${m.parts.length})`).join(", ")}`);
  }

  const DEFAULT_STEPS = JSON.stringify([
    "Disconnect power to the appliance (and water supply where applicable)",
    "Remove the old part — the linked video shows the exact procedure",
    "Install the new part, reconnect power, and verify operation",
  ]);

  await db().tx(async (t) => {
    // Remove invented seed parts whose mfr numbers collide with different real
    // parts (skip any that an order references)
    for (const fakeNo of STALE_FAKES) {
      const row = await t.get<{ id: number }>("SELECT id FROM parts WHERE part_no = ?", [fakeNo]);
      if (!row) continue;
      const used = await t.get("SELECT 1 AS x FROM order_items WHERE part_id = ? LIMIT 1", [row.id]);
      if (used) continue;
      await t.exec("DELETE FROM compatibility WHERE part_id = ?", [row.id]);
      await t.exec("DELETE FROM install_guides WHERE part_id = ?", [row.id]);
      await t.exec("DELETE FROM carts WHERE part_id = ?", [row.id]);
      await t.exec("DELETE FROM parts WHERE id = ?", [row.id]);
      console.log(`removed stale fake ${fakeNo}`);
    }
    // 1. Remap invented part numbers to their real PartSelect numbers in place
    for (const [fake, real] of Object.entries(harvest.remap)) {
      const fakeRow = await t.get("SELECT id FROM parts WHERE part_no = ?", [fake]);
      const realRow = await t.get("SELECT id FROM parts WHERE part_no = ?", [real]);
      if (fakeRow && !realRow) {
        await t.exec("UPDATE parts SET part_no = ? WHERE part_no = ?", [real, fake]);
        console.log(`remapped ${fake} -> ${real}`);
      }
    }

    let upserted = 0, links = 0, guides = 0;
    const processed = new Set<string>();
    for (const model of harvest.models) {
      const modelRow = await t.get<{ id: number }>(
        "SELECT id FROM appliance_models WHERE model_no = ?", [model.modelNo]
      );
      if (!modelRow) {
        console.warn(`model ${model.modelNo} not in DB, skipping`);
        continue;
      }

      for (const p of model.parts) {
        processed.add(p.ps);
        const detail = harvest.details[p.ps];
        const existing = await t.get<{ id: number; stock_qty: number }>(
          "SELECT id, stock_qty FROM parts WHERE part_no = ?", [p.ps]
        );
        const url = `https://www.partselect.com/${p.ps}-${detail?.slug ?? p.slug}.htm`;
        const price = detail?.price ?? Number(p.price);
        if (!Number.isFinite(price) || price <= 0) continue;
        const qty = stockQty(p.stock, existing?.stock_qty);

        let partId: number;
        if (existing) {
          await t.exec(
            `UPDATE parts SET mfr_part_no = ?, name = ?, price = ?, stock_qty = ?,
               product_url = ?, appliance_type = ?, brand = ?,
               description = COALESCE(?, description),
               symptoms = COALESCE(?, symptoms)
             WHERE id = ?`,
            [p.mfr, p.name, price, qty, url, model.type, model.brand,
             detail?.description ?? null, detail?.symptoms ?? null, existing.id]
          );
          partId = existing.id;
        } else {
          const ins = await t.get<{ id: number }>(
            `INSERT INTO parts (part_no, mfr_part_no, name, description, appliance_type,
               brand, price, stock_qty, product_url, symptoms)
             VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id`,
            [p.ps, p.mfr, p.name,
             detail?.description ?? `Genuine ${model.brand} ${p.name} (${p.mfr}).`,
             model.type, model.brand, price, qty, url, detail?.symptoms ?? null]
          );
          partId = ins!.id;
        }
        upserted++;

        await t.exec(
          "INSERT INTO compatibility (part_id, model_id) VALUES (?,?) ON CONFLICT DO NOTHING",
          [partId, modelRow.id]
        );
        links++;

        if (detail) {
          const existingGuide = await t.get<{ steps_json: string }>(
            "SELECT steps_json FROM install_guides WHERE part_id = ?", [partId]
          );
          const steps = existingGuide?.steps_json ?? DEFAULT_STEPS;
          await t.exec(
            `INSERT INTO install_guides (part_id, difficulty, est_time_minutes, tools, steps_json, video_url, manual_url)
             VALUES (?,?,?,?,?,?,?)
             ON CONFLICT (part_id) DO UPDATE SET
               difficulty = excluded.difficulty,
               est_time_minutes = excluded.est_time_minutes,
               video_url = excluded.video_url,
               manual_url = excluded.manual_url`,
            [partId, DIFFICULTY[detail.difficulty] ?? "medium", minutes(detail.installTime),
             "See video for required tools", steps, detail.videoUrl, url]
          );
          guides++;
        }
      }
    }
    // Detail entries not present in any model listing (a directly-harvested page):
    // update the existing part's fields and guide; no invented compatibility links.
    for (const [ps, detail] of Object.entries(harvest.details)) {
      if (processed.has(ps)) continue;
      const existing = await t.get<{ id: number }>("SELECT id FROM parts WHERE part_no = ?", [ps]);
      if (!existing) continue;
      await t.exec(
        `UPDATE parts SET
           price = COALESCE(?, price),
           description = COALESCE(?, description),
           symptoms = COALESCE(?, symptoms),
           product_url = COALESCE(?, product_url)
         WHERE id = ?`,
        [detail.price ?? null, detail.description ?? null, detail.symptoms ?? null,
         detail.slug ? `https://www.partselect.com/${ps}-${detail.slug}.htm` : null, existing.id]
      );
      const existingGuide = await t.get<{ steps_json: string }>(
        "SELECT steps_json FROM install_guides WHERE part_id = ?", [existing.id]
      );
      await t.exec(
        `INSERT INTO install_guides (part_id, difficulty, est_time_minutes, tools, steps_json, video_url, manual_url)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT (part_id) DO UPDATE SET
           difficulty = excluded.difficulty,
           est_time_minutes = excluded.est_time_minutes,
           video_url = excluded.video_url`,
        [existing.id, DIFFICULTY[detail.difficulty] ?? "medium", minutes(detail.installTime),
         "See video for required tools", existingGuide?.steps_json ?? DEFAULT_STEPS, detail.videoUrl,
         detail.slug ? `https://www.partselect.com/${ps}-${detail.slug}.htm` : null]
      );
      upserted++; guides++;
      console.log(`detail-only update: ${ps}`);
    }

    console.log(`Ingest complete: ${upserted} parts upserted, ${links} compatibility links, ${guides} install guides enriched.`);
  });
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
