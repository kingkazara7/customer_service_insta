import { getDb } from "../db/connection";

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

export function getPartByNo(partNo: string): Part | undefined {
  return getDb()
    .prepare(`SELECT ${PART_COLS} FROM parts WHERE part_no = ? COLLATE NOCASE`)
    .get(partNo.trim()) as Part | undefined;
}

export function getModelByNo(modelNo: string): ApplianceModel | undefined {
  return getDb()
    .prepare(
      "SELECT id, model_no, brand, appliance_type, name FROM appliance_models WHERE model_no = ? COLLATE NOCASE"
    )
    .get(modelNo.trim()) as ApplianceModel | undefined;
}

/** M 模块:型号查不到时,按公共前缀递减做相近匹配 */
export function findSimilarModels(modelNo: string, limit = 4): ApplianceModel[] {
  const db = getDb();
  const q = modelNo.trim().toUpperCase();
  for (let len = Math.min(q.length, 10); len >= 3; len--) {
    const rows = db
      .prepare(
        `SELECT id, model_no, brand, appliance_type, name FROM appliance_models
         WHERE UPPER(model_no) LIKE ? LIMIT ?`
      )
      .all(q.slice(0, len) + "%", limit) as ApplianceModel[];
    if (rows.length > 0) return rows;
  }
  // 前缀完全不匹配时退化为包含匹配
  return db
    .prepare(
      `SELECT id, model_no, brand, appliance_type, name FROM appliance_models
       WHERE UPPER(model_no) LIKE ? LIMIT ?`
    )
    .all(`%${q.slice(0, 4)}%`, limit) as ApplianceModel[];
}

/** P 模块:零件号查不到时的相近匹配 */
export function findSimilarParts(partNo: string, limit = 4): Part[] {
  const db = getDb();
  const q = partNo.trim().toUpperCase();
  for (let len = Math.min(q.length, 9); len >= 4; len--) {
    const rows = db
      .prepare(`SELECT ${PART_COLS} FROM parts WHERE UPPER(part_no) LIKE ? LIMIT ?`)
      .all(q.slice(0, len) + "%", limit) as Part[];
    if (rows.length > 0) return rows;
  }
  return [];
}

export function checkCompatibility(partNo: string, modelNo: string) {
  const part = getPartByNo(partNo);
  const model = getModelByNo(modelNo);
  if (!part || !model) {
    return {
      compatible: false as const,
      partFound: !!part,
      modelFound: !!model,
      part: part ?? null,
      model: model ?? null,
      similarModels: model ? [] : findSimilarModels(modelNo),
      similarParts: part ? [] : findSimilarParts(partNo),
    };
  }
  const hit = getDb()
    .prepare(
      "SELECT 1 FROM compatibility WHERE part_id = ? AND model_id = ?"
    )
    .get(part.id, model.id);
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

export function getCompatibleModels(partNo: string): ApplianceModel[] {
  return getDb()
    .prepare(
      `SELECT m.id, m.model_no, m.brand, m.appliance_type, m.name
       FROM compatibility c
       JOIN parts p ON p.id = c.part_id
       JOIN appliance_models m ON m.id = c.model_id
       WHERE p.part_no = ? COLLATE NOCASE`
    )
    .all(partNo.trim()) as ApplianceModel[];
}

/**
 * 关键词抽取:ASCII 词保留原样;中文长词额外切成二元组(bigram),
 * 容忍"不工作了/不工作"这类自然语言变体。
 */
function extractTerms(query: string): string[] {
  const tokens = query
    .split(/[\s,，、;；。?？!!]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  const terms: string[] = [];
  for (const tok of tokens) {
    if (/[一-鿿]/.test(tok) && tok.length > 4) {
      for (let i = 0; i < tok.length - 1; i++) terms.push(tok.slice(i, i + 2));
    } else {
      terms.push(tok);
    }
  }
  const deduped = [...new Set(terms)].slice(0, 14);
  return deduped.length > 0 ? deduped : [query.trim()];
}

/**
 * 关键词搜索:按 名称/描述/症状 匹配,可选限定型号(只返回兼容件)。
 * 状态机与 Agent 共用;症状词命中加权排序。
 */
export function searchParts(opts: {
  query: string;
  applianceType?: "refrigerator" | "dishwasher";
  modelNo?: string;
  limit?: number;
}): Part[] {
  const db = getDb();
  const limit = opts.limit ?? 6;
  const terms = extractTerms(opts.query);

  const scoreExpr = terms
    .map(
      (_, i) =>
        `(CASE WHEN symptoms LIKE @t${i} THEN 3 WHEN name LIKE @t${i} THEN 2 WHEN description LIKE @t${i} THEN 1 ELSE 0 END)`
    )
    .join(" + ");
  const params: Record<string, string> = {};
  terms.forEach((t, i) => (params[`t${i}`] = `%${t}%`));

  let sql = `SELECT ${PART_COLS}, (${scoreExpr}) AS score FROM parts WHERE (${scoreExpr}) > 0`;
  if (opts.applianceType) {
    sql += ` AND appliance_type = @atype`;
    params["atype"] = opts.applianceType;
  }
  if (opts.modelNo) {
    sql += ` AND id IN (
      SELECT c.part_id FROM compatibility c
      JOIN appliance_models m ON m.id = c.model_id
      WHERE m.model_no = @model COLLATE NOCASE)`;
    params["model"] = opts.modelNo.trim();
  }
  sql += ` ORDER BY score DESC, stock_qty DESC LIMIT ${limit}`;
  return db.prepare(sql).all(params) as Part[];
}

/** 某型号的全部兼容零件(预购分支"看看常用件"用) */
export function getPartsForModel(modelNo: string, limit = 10): Part[] {
  return getDb()
    .prepare(
      `SELECT ${PART_COLS} FROM parts WHERE id IN (
         SELECT c.part_id FROM compatibility c
         JOIN appliance_models m ON m.id = c.model_id
         WHERE m.model_no = ? COLLATE NOCASE)
       ORDER BY stock_qty DESC LIMIT ?`
    )
    .all(modelNo.trim(), limit) as Part[];
}

export function getInstallGuide(partNo: string): InstallGuide | undefined {
  const row = getDb()
    .prepare(
      `SELECT p.part_no, p.name AS part_name, g.difficulty, g.est_time_minutes,
              g.tools, g.steps_json, g.video_url, g.manual_url
       FROM install_guides g JOIN parts p ON p.id = g.part_id
       WHERE p.part_no = ? COLLATE NOCASE`
    )
    .get(partNo.trim()) as
    | (Omit<InstallGuide, "steps"> & { steps_json: string })
    | undefined;
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
 * RAG 检索。当前为关键词加权(symptom_tags 命中优先);
 * embedding 管道就绪后由向量相似度替换,接口不变。
 */
export function searchDocChunks(opts: {
  query: string;
  applianceType?: "refrigerator" | "dishwasher";
  partNo?: string;
  limit?: number;
  /** bigram 噪声门槛:真实症状命中通常 ≥6 分,随机文本 ≤2 分 */
  minScore?: number;
}): DocChunk[] {
  const db = getDb();
  const limit = opts.limit ?? 3;
  const minScore = opts.minScore ?? 3;
  const terms = extractTerms(opts.query);

  const scoreExpr = terms
    .map(
      (_, i) =>
        `(CASE WHEN symptom_tags LIKE @t${i} THEN 3 WHEN chunk_text LIKE @t${i} THEN 1 ELSE 0 END)`
    )
    .join(" + ");
  const params: Record<string, string> = {};
  terms.forEach((t, i) => (params[`t${i}`] = `%${t}%`));

  let sql = `SELECT id, source_type, part_id, appliance_type, symptom_tags, chunk_text, source_url, source_ref,
                    (${scoreExpr}) AS score
             FROM doc_chunks WHERE (${scoreExpr}) >= ${minScore}`;
  if (opts.applianceType) {
    sql += ` AND appliance_type = @atype`;
    params["atype"] = opts.applianceType;
  }
  if (opts.partNo) {
    sql += ` AND part_id = (SELECT id FROM parts WHERE part_no = @pno COLLATE NOCASE)`;
    params["pno"] = opts.partNo.trim();
  }
  sql += ` ORDER BY score DESC LIMIT ${limit}`;
  return db.prepare(sql).all(params) as DocChunk[];
}
