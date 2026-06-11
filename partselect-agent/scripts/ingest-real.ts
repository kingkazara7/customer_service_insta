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
import { getDb } from "../src/server/db/connection";

type ListingPart = {
  ps: string; mfr: string; name: string; price: number; stock: string; slug: string;
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

function stockQty(stock: string, existing: number | undefined): number {
  if (stock === "In Stock") return existing && existing > 0 ? existing : 20;
  if (stock === "Special Order" || stock === "On Order") return 3;
  return 0;
}

function main() {
  const raw = fs.readFileSync(
    path.join(process.cwd(), "data", "ingested", "real-parts.json"),
    "utf8"
  );
  const harvest = JSON.parse(raw) as Harvest;
  const db = getDb();

  const run = db.transaction(() => {
    // 1. Remap invented part numbers to their real PartSelect numbers in place
    for (const [fake, real] of Object.entries(harvest.remap)) {
      const fakeRow = db.prepare("SELECT id FROM parts WHERE part_no = ?").get(fake);
      const realRow = db.prepare("SELECT id FROM parts WHERE part_no = ?").get(real);
      if (fakeRow && !realRow) {
        db.prepare("UPDATE parts SET part_no = ? WHERE part_no = ?").run(real, fake);
        console.log(`remapped ${fake} -> ${real}`);
      }
    }

    let upserted = 0, links = 0, guides = 0;
    const processed = new Set<string>();
    for (const model of harvest.models) {
      const modelRow = db
        .prepare("SELECT id FROM appliance_models WHERE model_no = ?")
        .get(model.modelNo) as { id: number } | undefined;
      if (!modelRow) {
        console.warn(`model ${model.modelNo} not in DB, skipping`);
        continue;
      }

      for (const p of model.parts) {
        processed.add(p.ps);
        const detail = harvest.details[p.ps];
        const existing = db
          .prepare("SELECT id, stock_qty FROM parts WHERE part_no = ?")
          .get(p.ps) as { id: number; stock_qty: number } | undefined;
        const url = `https://www.partselect.com/${p.ps}-${detail?.slug ?? p.slug}.htm`;
        const price = detail?.price ?? p.price;
        const qty = stockQty(p.stock, existing?.stock_qty);

        let partId: number;
        if (existing) {
          db.prepare(
            `UPDATE parts SET mfr_part_no = ?, name = ?, price = ?, stock_qty = ?,
               product_url = ?, appliance_type = ?, brand = ?,
               description = COALESCE(?, description),
               symptoms = COALESCE(?, symptoms)
             WHERE id = ?`
          ).run(
            p.mfr, p.name, price, qty, url, model.type, model.brand,
            detail?.description ?? null, detail?.symptoms ?? null, existing.id
          );
          partId = existing.id;
        } else {
          partId = Number(
            db.prepare(
              `INSERT INTO parts (part_no, mfr_part_no, name, description, appliance_type,
                 brand, price, stock_qty, product_url, symptoms)
               VALUES (?,?,?,?,?,?,?,?,?,?)`
            ).run(
              p.ps, p.mfr, p.name,
              detail?.description ?? `Genuine ${model.brand} ${p.name} (${p.mfr}).`,
              model.type, model.brand, price, qty, url,
              detail?.symptoms ?? null
            ).lastInsertRowid
          );
        }
        upserted++;

        db.prepare(
          "INSERT OR IGNORE INTO compatibility (part_id, model_id) VALUES (?,?)"
        ).run(partId, modelRow.id);
        links++;

        if (detail) {
          const existingGuide = db
            .prepare("SELECT steps_json FROM install_guides WHERE part_id = ?")
            .get(partId) as { steps_json: string } | undefined;
          const steps = existingGuide
            ? existingGuide.steps_json
            : JSON.stringify([
                "Disconnect power to the appliance (and water supply where applicable)",
                `Remove the old part — the linked video shows the exact procedure for the ${p.name}`,
                "Install the new part, reconnect power, and verify operation",
              ]);
          db.prepare(
            `INSERT INTO install_guides (part_id, difficulty, est_time_minutes, tools, steps_json, video_url, manual_url)
             VALUES (?,?,?,?,?,?,?)
             ON CONFLICT(part_id) DO UPDATE SET
               difficulty = excluded.difficulty,
               est_time_minutes = excluded.est_time_minutes,
               video_url = excluded.video_url,
               manual_url = excluded.manual_url`
          ).run(
            partId, DIFFICULTY[detail.difficulty] ?? "medium", minutes(detail.installTime),
            "See video for required tools", steps, detail.videoUrl, url
          );
          guides++;
        }
      }
    }
    // Detail entries not present in any model listing (e.g. a part page that was
    // harvested directly): update the existing part's fields and guide, but do
    // not invent compatibility links we didn't observe.
    for (const [ps, detail] of Object.entries(harvest.details)) {
      if (processed.has(ps)) continue;
      const existing = db
        .prepare("SELECT id FROM parts WHERE part_no = ?")
        .get(ps) as { id: number } | undefined;
      if (!existing) continue;
      db.prepare(
        `UPDATE parts SET
           price = COALESCE(?, price),
           description = COALESCE(?, description),
           symptoms = COALESCE(?, symptoms),
           product_url = COALESCE(?, product_url)
         WHERE id = ?`
      ).run(
        detail.price ?? null, detail.description ?? null, detail.symptoms ?? null,
        detail.slug ? `https://www.partselect.com/${ps}-${detail.slug}.htm` : null,
        existing.id
      );
      const existingGuide = db
        .prepare("SELECT steps_json FROM install_guides WHERE part_id = ?")
        .get(existing.id) as { steps_json: string } | undefined;
      db.prepare(
        `INSERT INTO install_guides (part_id, difficulty, est_time_minutes, tools, steps_json, video_url, manual_url)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(part_id) DO UPDATE SET
           difficulty = excluded.difficulty,
           est_time_minutes = excluded.est_time_minutes,
           video_url = excluded.video_url`
      ).run(
        existing.id, DIFFICULTY[detail.difficulty] ?? "medium", minutes(detail.installTime),
        "See video for required tools",
        existingGuide?.steps_json ?? JSON.stringify([
          "Disconnect power to the appliance",
          "Remove the old part — the linked video shows the exact procedure",
          "Install the new part and verify operation",
        ]),
        detail.videoUrl,
        detail.slug ? `https://www.partselect.com/${ps}-${detail.slug}.htm` : null
      );
      upserted++; guides++;
      console.log(`detail-only update: ${ps}`);
    }

    console.log(`Ingest complete: ${upserted} parts upserted, ${links} compatibility links, ${guides} install guides enriched.`);
  });
  run();
}

main();
