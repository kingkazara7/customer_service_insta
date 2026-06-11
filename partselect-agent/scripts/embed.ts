/**
 * Offline embedding script: vectorizes doc_chunks body text and writes the
 * vectors back to the database.
 * Usage:
 *   EMBEDDINGS_PROVIDER=bedrock npx tsx scripts/embed.ts   (EC2/prod, Titan v2)
 *   EMBEDDINGS_PROVIDER=local   npx tsx scripts/embed.ts   (local, needs `npm i @xenova/transformers`)
 * Re-running after switching providers re-embeds everything (dimensions must not mix).
 */
import { getDb } from "../src/server/db/connection";
import { getEmbeddingProvider, vecToBlob } from "../src/server/embeddings/provider";

async function main() {
  const provider = getEmbeddingProvider();
  if (!provider) {
    console.error("EMBEDDINGS_PROVIDER is not set (bedrock|local) — exiting.");
    process.exit(1);
  }
  const db = getDb();
  db.prepare("UPDATE doc_chunks SET embedding = NULL").run();
  const rows = db
    .prepare("SELECT id, symptom_tags, chunk_text FROM doc_chunks")
    .all() as { id: number; symptom_tags: string | null; chunk_text: string }[];

  console.log(`Embedding ${rows.length} chunks with ${provider.name} (${provider.dims} dims)…`);
  const upd = db.prepare("UPDATE doc_chunks SET embedding = ? WHERE id = ?");
  for (const row of rows) {
    // Symptom tags are embedded together with the body to improve recall on symptom queries
    const text = `${row.symptom_tags ?? ""}\n${row.chunk_text}`;
    const [v] = await provider.embed([text]);
    upd.run(vecToBlob(v), row.id);
    process.stdout.write(".");
  }
  console.log(`\nDone: ${rows.length} chunks vectorized.`);
}

main();
