import { getDb } from "../db/connection";
import type { ApplianceModel } from "./catalog";

export type UserAppliance = ApplianceModel & { source: "purchased" | "searched" };

export function getOrCreateDemoUser(): number {
  const db = getDb();
  const row = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get("demo@example.com") as { id: number } | undefined;
  if (row) return row.id;
  return Number(
    db.prepare("INSERT INTO users (email, name) VALUES (?,?)")
      .run("demo@example.com", "Demo User").lastInsertRowid
  );
}

/** Data source for the appliance-card view */
export function getAppliances(userId: number): UserAppliance[] {
  return getDb()
    .prepare(
      `SELECT m.id, m.model_no, m.brand, m.appliance_type, m.name, ua.source
       FROM user_appliances ua JOIN appliance_models m ON m.id = ua.model_id
       WHERE ua.user_id = ?
       ORDER BY CASE ua.source WHEN 'purchased' THEN 0 ELSE 1 END, ua.last_seen DESC`
    )
    .all(userId) as UserAppliance[];
}

/** Quick-pick list of previously purchased parts (install branch) */
export function getPurchasedParts(userId: number) {
  return getDb()
    .prepare(
      `SELECT DISTINCT p.part_no, p.name, p.appliance_type, p.brand, p.price
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN parts p ON p.id = oi.part_id
       WHERE o.user_id = ?
       ORDER BY o.created_at DESC LIMIT 8`
    )
    .all(userId) as {
    part_no: string; name: string; appliance_type: string; brand: string | null; price: number;
  }[];
}

export function upsertAppliance(
  userId: number,
  modelNo: string,
  source: "purchased" | "searched"
): void {
  const db = getDb();
  const model = db
    .prepare("SELECT id FROM appliance_models WHERE model_no = ? COLLATE NOCASE")
    .get(modelNo.trim()) as { id: number } | undefined;
  if (!model) return;
  // "purchased" outranks "searched" and is never downgraded
  db.prepare(
    `INSERT INTO user_appliances (user_id, model_id, source) VALUES (?,?,?)
     ON CONFLICT(user_id, model_id) DO UPDATE SET
       source = CASE WHEN user_appliances.source = 'purchased' THEN 'purchased' ELSE excluded.source END,
       last_seen = datetime('now')`
  ).run(userId, model.id, source);
}

export function recordSearch(
  userId: number,
  query: string,
  modelNo?: string,
  partNo?: string
): void {
  getDb()
    .prepare(
      "INSERT INTO search_history (user_id, query, model_no, part_no) VALUES (?,?,?,?)"
    )
    .run(userId, query, modelNo ?? null, partNo ?? null);
  if (modelNo) upsertAppliance(userId, modelNo, "searched");
}

export function getSavedAddress(userId: number): Record<string, string> | null {
  const row = getDb()
    .prepare("SELECT address_json FROM users WHERE id = ?")
    .get(userId) as { address_json: string | null } | undefined;
  return row?.address_json ? JSON.parse(row.address_json) : null;
}

/**
 * One-line user profile injected into the agent context — replaces replaying
 * past conversations and is a key token-saving measure.
 */
export function profileSummary(userId: number): string {
  const appliances = getAppliances(userId);
  const parts = getPurchasedParts(userId);
  const a = appliances
    .map((x) => `${x.brand} ${x.model_no} (${x.appliance_type}, ${x.source === "purchased" ? "owned" : "searched"})`)
    .join(", ");
  const p = parts.map((x) => `${x.part_no} ${x.name}`).join(", ");
  return `User appliances: ${a || "none on file"}. Previously purchased parts: ${p || "none"}.`;
}
