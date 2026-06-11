import { db } from "../db/connection";
import type { ApplianceModel } from "./catalog";

export type UserAppliance = ApplianceModel & { source: "purchased" | "searched" };

export async function getOrCreateDemoUser(): Promise<number> {
  return (await getOrCreateUserByEmail("demo@example.com")).id;
}

/** Guest account: full functionality, no history (email stays null) */
export async function createGuestUser(): Promise<number> {
  const row = await db().get<{ id: number }>(
    "INSERT INTO users (name) VALUES ('Guest') RETURNING id"
  );
  return row!.id;
}

/**
 * For customers who bought parts but never registered an appliance:
 * infer which machines they likely own from part compatibility,
 * ranked by how many of their purchased parts fit each model.
 */
export async function inferModelsFromPurchases(userId: number, limit = 4): Promise<ApplianceModel[]> {
  return db().all<ApplianceModel>(
    `SELECT m.id, m.model_no, m.brand, m.appliance_type, m.name
     FROM appliance_models m
     JOIN compatibility c ON c.model_id = m.id
     JOIN order_items oi ON oi.part_id = c.part_id
     JOIN orders o ON o.id = oi.order_id
     WHERE o.user_id = ?
       AND m.id NOT IN (SELECT model_id FROM user_appliances WHERE user_id = ?)
     GROUP BY m.id, m.model_no, m.brand, m.appliance_type, m.name
     ORDER BY COUNT(DISTINCT oi.part_id) DESC, m.model_no
     LIMIT ?`,
    [userId, userId, limit]
  );
}

/**
 * Email-based identification: returning customers get their purchase history
 * (appliance cards, past parts, saved address); unknown emails get a fresh account.
 * Demo-grade auth — production would add a verification step (magic link / OTP).
 */
export async function getOrCreateUserByEmail(email: string): Promise<{
  id: number;
  isNew: boolean;
  name: string | null;
}> {
  const normalized = email.trim().toLowerCase();
  const row = await db().get<{ id: number; name: string | null }>(
    "SELECT id, name FROM users WHERE LOWER(email) = ?",
    [normalized]
  );
  if (row) return { id: row.id, isNew: false, name: row.name };
  const created = await db().get<{ id: number }>(
    "INSERT INTO users (email) VALUES (?) RETURNING id",
    [normalized]
  );
  return { id: created!.id, isNew: true, name: null };
}

/** Data source for the appliance-card view */
export async function getAppliances(userId: number): Promise<UserAppliance[]> {
  return db().all<UserAppliance>(
    `SELECT m.id, m.model_no, m.brand, m.appliance_type, m.name, ua.source
     FROM user_appliances ua JOIN appliance_models m ON m.id = ua.model_id
     WHERE ua.user_id = ?
     ORDER BY CASE ua.source WHEN 'purchased' THEN 0 ELSE 1 END, ua.last_seen DESC`,
    [userId]
  );
}

/** Quick-pick list of previously purchased parts (install branch) */
export async function getPurchasedParts(userId: number) {
  return db().all<{
    part_no: string; name: string; appliance_type: string; brand: string | null; price: number;
  }>(
    `SELECT DISTINCT p.part_no, p.name, p.appliance_type, p.brand, p.price, MAX(o.created_at) AS last_at
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN parts p ON p.id = oi.part_id
     WHERE o.user_id = ?
     GROUP BY p.part_no, p.name, p.appliance_type, p.brand, p.price
     ORDER BY last_at DESC LIMIT 8`,
    [userId]
  );
}

export async function upsertAppliance(
  userId: number,
  modelNo: string,
  source: "purchased" | "searched"
): Promise<void> {
  const model = await db().get<{ id: number }>(
    "SELECT id FROM appliance_models WHERE LOWER(model_no) = LOWER(?)",
    [modelNo.trim()]
  );
  if (!model) return;
  // "purchased" outranks "searched" and is never downgraded
  await db().exec(
    `INSERT INTO user_appliances (user_id, model_id, source) VALUES (?,?,?)
     ON CONFLICT (user_id, model_id) DO UPDATE SET
       source = CASE WHEN user_appliances.source = 'purchased' THEN 'purchased' ELSE excluded.source END,
       last_seen = CURRENT_TIMESTAMP`,
    [userId, model.id, source]
  );
}

export async function recordSearch(
  userId: number,
  query: string,
  modelNo?: string,
  partNo?: string
): Promise<void> {
  await db().exec(
    "INSERT INTO search_history (user_id, query, model_no, part_no) VALUES (?,?,?,?)",
    [userId, query, modelNo ?? null, partNo ?? null]
  );
  if (modelNo) await upsertAppliance(userId, modelNo, "searched");
}

export async function getSavedAddress(userId: number): Promise<Record<string, string> | null> {
  const row = await db().get<{ address_json: string | null }>(
    "SELECT address_json FROM users WHERE id = ?",
    [userId]
  );
  return row?.address_json ? JSON.parse(row.address_json) : null;
}

/**
 * One-line user profile injected into the agent context — replaces replaying
 * past conversations and is a key token-saving measure.
 */
export async function profileSummary(userId: number): Promise<string> {
  const appliances = await getAppliances(userId);
  const parts = await getPurchasedParts(userId);
  const a = appliances
    .map((x) => `${x.brand} ${x.model_no} (${x.appliance_type}, ${x.source === "purchased" ? "owned" : "searched"})`)
    .join(", ");
  const p = parts.map((x) => `${x.part_no} ${x.name}`).join(", ");
  return `User appliances: ${a || "none on file"}. Previously purchased parts: ${p || "none"}.`;
}
