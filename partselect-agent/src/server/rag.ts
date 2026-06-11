import { getDb } from "./db/connection";
import { searchDocChunks, type DocChunk } from "./services/catalog";
import { getEmbeddingProvider, cosineSim, blobToVec } from "./embeddings/provider";

/**
 * Unified RAG entry point: when vectors exist (embed script has run and a
 * provider is configured) → cosine-similarity retrieval; otherwise fall back
 * to keyword retrieval. Callers never notice the difference.
 * On SQLite, cosine runs in-process (milliseconds at demo scale); on RDS
 * pgvector this becomes the `<=>` operator.
 */
export async function retrieveChunks(opts: {
  query: string;
  applianceType?: "refrigerator" | "dishwasher";
  partNo?: string;
  limit?: number;
}): Promise<DocChunk[]> {
  const provider = getEmbeddingProvider();
  if (provider) {
    try {
      const db = getDb();
      const params: Record<string, string> = {};
      let sql = `SELECT id, source_type, part_id, appliance_type, symptom_tags,
                        chunk_text, source_url, source_ref, embedding
                 FROM doc_chunks WHERE embedding IS NOT NULL`;
      if (opts.applianceType) {
        sql += " AND appliance_type = @atype";
        params["atype"] = opts.applianceType;
      }
      if (opts.partNo) {
        sql += " AND part_id = (SELECT id FROM parts WHERE part_no = @pno COLLATE NOCASE)";
        params["pno"] = opts.partNo.trim();
      }
      const rows = db.prepare(sql).all(params) as (DocChunk & { embedding: Buffer })[];
      if (rows.length > 0) {
        const [qv] = await provider.embed([opts.query]);
        const scored = rows
          .map((r) => ({ r, sim: cosineSim(qv, blobToVec(r.embedding)) }))
          .filter((x) => x.sim >= 0.3)
          .sort((a, b) => b.sim - a.sim)
          .slice(0, opts.limit ?? 3);
        if (scored.length > 0) {
          return scored.map(({ r }) => {
            const { embedding: _omit, ...chunk } = r;
            return chunk;
          });
        }
      }
    } catch (err) {
      console.error("vector retrieval failed, falling back to keyword:", err);
    }
  }
  return searchDocChunks(opts);
}
