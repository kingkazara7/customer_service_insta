import { db } from "../db/connection";

export type Part = {
  id: number;
  part_no: string;
  mfr_part_no: string | null;
  name: string;
  description: string | null;
  appliance_type: "refrigerator" | "dishwasher";
  brand: string | null;
  price: number;
  stock_qty: number;
  image_url: string | null;
  product_url: string | null;
  symptoms: string | null;
};

export type ApplianceModel = {
  id: number;
  model_no: string;
  brand: string;
  appliance_type: "refrigerator" | "dishwasher";
  name: string | null;
};

export type InstallGuide = {
  part_no: string;
  part_name: string;
  difficulty: string | null;
  est_time_minutes: number | null;
  tools: string | null;
  steps: string[];
  video_url: string | null;
  manual_url: string | null;
};

const PART_COLS =
  "id, part_no, mfr_part_no, name, description, appliance_type, brand, price, stock_qty, image_url, product_url, symptoms";

/** Look up a part by its PartSelect number OR its manufacturer part number. */
export async function getPartByNo(partNo: string): Promise<Part | undefined> {
  const q = partNo.trim();
  return db().get<Part>(
    `SELECT ${PART_COLS} FROM parts WHERE LOWER(part_no) = LOWER(?) OR LOWER(mfr_part_no) = LOWER(?)`,
    [q, q]
  );
}

export async function getModelByNo(modelNo: string): Promise<ApplianceModel | undefined> {
  return db().get<ApplianceModel>(
    "SELECT id, model_no, brand, appliance_type, name FROM appliance_models WHERE LOWER(model_no) = LOWER(?)",
    [modelNo.trim()]
  );
}

/** M module: when a model isn't found, match close models by shrinking common prefix */
export async function findSimilarModels(modelNo: string, limit = 4): Promise<ApplianceModel[]> {
  const q = modelNo.trim().toUpperCase();
  for (let len = Math.min(q.length, 10); len >= 3; len--) {
    const rows = await db().all<ApplianceModel>(
      `SELECT id, model_no, brand, appliance_type, name FROM appliance_models
       WHERE UPPER(model_no) LIKE ? LIMIT ?`,
      [q.slice(0, len) + "%", limit]
    );
    if (rows.length > 0) return rows;
  }
  // No prefix match at all → degrade to a contains match
  return db().all<ApplianceModel>(
    `SELECT id, model_no, brand, appliance_type, name FROM appliance_models
     WHERE UPPER(model_no) LIKE ? LIMIT ?`,
    [`%${q.slice(0, 4)}%`, limit]
  );
}

/** P module: close matches when a part number isn't found */
export async function findSimilarParts(partNo: string, limit = 4): Promise<Part[]> {
  const q = partNo.trim().toUpperCase();
  for (let len = Math.min(q.length, 9); len >= 4; len--) {
    const rows = await db().all<Part>(
      `SELECT ${PART_COLS} FROM parts WHERE UPPER(part_no) LIKE ? LIMIT ?`,
      [q.slice(0, len) + "%", limit]
    );
    if (rows.length > 0) return rows;
  }
  return [];
}

export async function checkCompatibility(partNo: string, modelNo: string) {
  const part = await getPartByNo(partNo);
  const model = await getModelByNo(modelNo);
  if (!part || !model) {
    return {
      compatible: false as const,
      partFound: !!part,
      modelFound: !!model,
      part: part ?? null,
      model: model ?? null,
      similarModels: model ? [] : await findSimilarModels(modelNo),
      similarParts: part ? [] : await findSimilarParts(partNo),
    };
  }
  const hit = await db().get(
    "SELECT 1 AS x FROM compatibility WHERE part_id = ? AND model_id = ?",
    [part.id, model.id]
  );
  return {
    compatible: !!hit,
    partFound: true as const,
    modelFound: true as const,
    part,
    model,
    similarModels: [] as ApplianceModel[],
    similarParts: [] as Part[],
  };
}

export async function getCompatibleModels(partNo: string): Promise<ApplianceModel[]> {
  return db().all<ApplianceModel>(
    `SELECT m.id, m.model_no, m.brand, m.appliance_type, m.name
     FROM compatibility c
     JOIN parts p ON p.id = c.part_id
     JOIN appliance_models m ON m.id = c.model_id
     WHERE LOWER(p.part_no) = LOWER(?)`,
    [partNo.trim()]
  );
}

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "my", "our",
  "your", "i", "it", "its", "of", "to", "for", "on", "in", "at", "with",
  "and", "or", "do", "does", "did", "how", "can", "could", "would", "what",
  "why", "when", "that", "this", "there", "have", "has", "had", "me", "we",
  "you", "please", "help", "not", "no", "out",
]);

/**
 * Keyword extraction tuned for natural-language queries:
 * - adjacent-word phrases ("ice maker", "not working") for precision,
 * - single non-stopword tokens for recall,
 * - CJK tokens longer than 4 chars are split into bigrams (standard CJK search practice).
 */
function extractTerms(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9一-鿿]+/i)
    .filter((t) => t.length >= 2);
  const terms: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    if (!STOPWORDS.has(tokens[i]) || !STOPWORDS.has(tokens[i + 1])) {
      terms.push(`${tokens[i]} ${tokens[i + 1]}`);
    }
  }
  for (const tok of tokens) {
    if (/[一-鿿]/.test(tok) && tok.length > 4) {
      for (let i = 0; i < tok.length - 1; i++) terms.push(tok.slice(i, i + 2));
    } else if (!STOPWORDS.has(tok)) {
      terms.push(tok);
    }
  }
  const deduped = [...new Set(terms)].slice(0, 14);
  return deduped.length > 0 ? deduped : [query.trim().toLowerCase()];
}

/**
 * Keyword search over name/description/symptoms, optionally scoped to a model
 * (returns compatible parts only). Shared by the state machine and the agent;
 * symptom hits are weighted highest in the ranking. Uses ILIKE-style matching
 * portably via LOWER(col) LIKE LOWER(?).
 */
export async function searchParts(opts: {
  query: string;
  applianceType?: "refrigerator" | "dishwasher";
  modelNo?: string;
  limit?: number;
}): Promise<Part[]> {
  const limit = opts.limit ?? 6;
  const terms = extractTerms(opts.query);
  const params: unknown[] = [];

  // score expression repeats the term list; build it with positional params.
  // Each term contributes the same three CASE checks, so push it 3× per use.
  const scoreExpr = (push: boolean) =>
    terms
      .map((t) => {
        if (push) params.push(`%${t}%`, `%${t}%`, `%${t}%`);
        return `(CASE WHEN LOWER(symptoms) LIKE LOWER(?) THEN 3 WHEN LOWER(name) LIKE LOWER(?) THEN 2 WHEN LOWER(description) LIKE LOWER(?) THEN 1 ELSE 0 END)`;
      })
      .join(" + ");

  const selectScore = scoreExpr(true);   // params for SELECT
  const whereScore = scoreExpr(true);    // params for WHERE
  let sql = `SELECT ${PART_COLS}, (${selectScore}) AS score FROM parts WHERE (${whereScore}) > 0`;
  if (opts.applianceType) {
    sql += ` AND appliance_type = ?`;
    params.push(opts.applianceType);
  }
  if (opts.modelNo) {
    sql += ` AND id IN (
      SELECT c.part_id FROM compatibility c
      JOIN appliance_models m ON m.id = c.model_id
      WHERE LOWER(m.model_no) = LOWER(?))`;
    params.push(opts.modelNo.trim());
  }
  sql += ` ORDER BY score DESC, stock_qty DESC LIMIT ?`;
  params.push(limit);
  return db().all<Part>(sql, params);
}

/** All compatible parts for a model (used by the pre-order "browse popular parts" path) */
export async function getPartsForModel(modelNo: string, limit = 10): Promise<Part[]> {
  return db().all<Part>(
    `SELECT ${PART_COLS} FROM parts WHERE id IN (
       SELECT c.part_id FROM compatibility c
       JOIN appliance_models m ON m.id = c.model_id
       WHERE LOWER(m.model_no) = LOWER(?))
     ORDER BY stock_qty DESC LIMIT ?`,
    [modelNo.trim(), limit]
  );
}

/**
 * Upsert a live-fetched part + its compatibility link. Used by the live
 * fallback to grow the catalog at runtime.
 */
export async function ingestLivePart(p: {
  part_no: string;
  mfr_part_no: string | null;
  name: string;
  description?: string | null;
  appliance_type: "refrigerator" | "dishwasher";
  brand: string | null;
  price: number;
  stock: string | null;
  product_url?: string | null;
  modelNo?: string;
}): Promise<void> {
  const qty =
    p.stock === "In Stock" ? 20
    : p.stock === "Special Order" || p.stock === "On Order" ? 3
    : 0;
  const url = p.product_url ?? `https://www.partselect.com/${p.part_no}.htm`;
  const existing = await db().get<{ id: number }>(
    "SELECT id FROM parts WHERE LOWER(part_no) = LOWER(?)",
    [p.part_no]
  );
  let partId: number;
  if (existing) {
    await db().exec(
      `UPDATE parts SET mfr_part_no = ?, name = ?, price = ?, stock_qty = ?,
         product_url = ?, appliance_type = ?, brand = ?,
         description = COALESCE(?, description)
       WHERE id = ?`,
      [p.mfr_part_no, p.name, p.price, qty, url, p.appliance_type, p.brand,
       p.description ?? null, existing.id]
    );
    partId = existing.id;
  } else {
    const row = await db().get<{ id: number }>(
      `INSERT INTO parts (part_no, mfr_part_no, name, description, appliance_type, brand, price, stock_qty, product_url)
       VALUES (?,?,?,?,?,?,?,?,?) RETURNING id`,
      [p.part_no, p.mfr_part_no, p.name,
       p.description ?? `Genuine ${p.brand ?? ""} ${p.name}.`.trim(),
       p.appliance_type, p.brand, p.price, qty, url]
    );
    partId = row!.id;
  }
  if (p.modelNo) {
    const model = await db().get<{ id: number }>(
      "SELECT id FROM appliance_models WHERE LOWER(model_no) = LOWER(?)",
      [p.modelNo]
    );
    if (model) {
      await db().exec(
        "INSERT INTO compatibility (part_id, model_id) VALUES (?,?) ON CONFLICT DO NOTHING",
        [partId, model.id]
      );
    }
  }
}

/** Create a model row if it doesn't exist (live fallback for unknown models). */
export async function ensureModel(
  modelNo: string, brand: string, applianceType: "refrigerator" | "dishwasher"
): Promise<void> {
  await db().exec(
    `INSERT INTO appliance_models (model_no, brand, appliance_type) VALUES (?,?,?) ON CONFLICT DO NOTHING`,
    [modelNo.trim().toUpperCase(), brand, applianceType]
  );
}

export async function getInstallGuide(partNo: string): Promise<InstallGuide | undefined> {
  const row = await db().get<Omit<InstallGuide, "steps"> & { steps_json: string }>(
    `SELECT p.part_no, p.name AS part_name, g.difficulty, g.est_time_minutes,
            g.tools, g.steps_json, g.video_url, g.manual_url
     FROM install_guides g JOIN parts p ON p.id = g.part_id
     WHERE LOWER(p.part_no) = LOWER(?)`,
    [partNo.trim()]
  );
  if (!row) return undefined;
  const { steps_json, ...rest } = row;
  return { ...rest, steps: JSON.parse(steps_json) as string[] };
}

export type DocChunk = {
  id: number;
  source_type: string;
  part_id: number | null;
  appliance_type: string | null;
  symptom_tags: string | null;
  chunk_text: string;
  source_url: string | null;
  source_ref: string | null;
};

/**
 * Keyword RAG retrieval (symptom_tags hits weighted highest). The vector path
 * in rag.ts supersedes this when embeddings are present; same interface.
 */
export async function searchDocChunks(opts: {
  query: string;
  applianceType?: "refrigerator" | "dishwasher";
  partNo?: string;
  limit?: number;
  /** Noise threshold: genuine symptom matches usually score ≥6, random text ≤2 */
  minScore?: number;
}): Promise<DocChunk[]> {
  const limit = opts.limit ?? 3;
  const minScore = opts.minScore ?? 3;
  const terms = extractTerms(opts.query);
  const params: unknown[] = [];

  const scoreExpr = () =>
    terms
      .map((t) => {
        params.push(`%${t}%`, `%${t}%`);
        return `(CASE WHEN LOWER(symptom_tags) LIKE LOWER(?) THEN 3 WHEN LOWER(chunk_text) LIKE LOWER(?) THEN 1 ELSE 0 END)`;
      })
      .join(" + ");

  const selectScore = scoreExpr();
  const whereScore = scoreExpr();
  let sql = `SELECT id, source_type, part_id, appliance_type, symptom_tags, chunk_text, source_url, source_ref,
                    (${selectScore}) AS score
             FROM doc_chunks WHERE (${whereScore}) >= ?`;
  params.push(minScore);
  if (opts.applianceType) {
    sql += ` AND appliance_type = ?`;
    params.push(opts.applianceType);
  }
  if (opts.partNo) {
    sql += ` AND part_id = (SELECT id FROM parts WHERE LOWER(part_no) = LOWER(?))`;
    params.push(opts.partNo.trim());
  }
  sql += ` ORDER BY score DESC LIMIT ?`;
  params.push(limit);
  return db().all<DocChunk>(sql, params);
}
