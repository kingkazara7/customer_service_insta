/**
 * 离线 embedding 脚本:把 doc_chunks 正文批量向量化写回数据库。
 * 用法:
 *   EMBEDDINGS_PROVIDER=bedrock npx tsx scripts/embed.ts   (EC2/生产,Titan v2)
 *   EMBEDDINGS_PROVIDER=local   npx tsx scripts/embed.ts   (本地,需 npm i @xenova/transformers)
 * 切换 provider 后重跑会全量重新嵌入(维度不同不能混用)。
 */
import { getDb } from "../src/server/db/connection";
import { getEmbeddingProvider, vecToBlob } from "../src/server/embeddings/provider";

async function main() {
  const provider = getEmbeddingProvider();
  if (!provider) {
    console.error("未配置 EMBEDDINGS_PROVIDER(bedrock|local),退出。");
    process.exit(1);
  }
  const db = getDb();
  db.prepare("UPDATE doc_chunks SET embedding = NULL").run();
  const rows = db
    .prepare("SELECT id, symptom_tags, chunk_text FROM doc_chunks")
    .all() as { id: number; symptom_tags: string | null; chunk_text: string }[];

  console.log(`使用 ${provider.name}(${provider.dims} 维)嵌入 ${rows.length} 个文档块…`);
  const upd = db.prepare("UPDATE doc_chunks SET embedding = ? WHERE id = ?");
  for (const row of rows) {
    // 症状标签拼进正文一起嵌入,提高症状类查询召回
    const text = `${row.symptom_tags ?? ""}\n${row.chunk_text}`;
    const [v] = await provider.embed([text]);
    upd.run(vecToBlob(v), row.id);
    process.stdout.write(".");
  }
  console.log(`\n完成:${rows.length} 个块已写入向量。`);
}

main();
