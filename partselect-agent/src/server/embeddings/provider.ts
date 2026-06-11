/**
 * Embedding 提供商抽象:
 *  - bedrock: Amazon Titan Text Embeddings v2(1024 维,生产/EC2 推荐,IAM 角色授权)
 *  - local:   @xenova/transformers 本地模型(384 维,离线开发用,需额外安装依赖)
 *  - none:    不可用 → RAG 自动退回关键词检索
 * 通过环境变量 EMBEDDINGS_PROVIDER 选择;链接与元数据不参与嵌入,只嵌入正文文本。
 */

export interface EmbeddingProvider {
  name: string;
  dims: number;
  embed(texts: string[]): Promise<number[][]>;
}

class BedrockTitanProvider implements EmbeddingProvider {
  name = "bedrock-titan-v2";
  dims = 1024;

  async embed(texts: string[]): Promise<number[][]> {
    const { BedrockRuntimeClient, InvokeModelCommand } = await import(
      "@aws-sdk/client-bedrock-runtime"
    );
    const client = new BedrockRuntimeClient({
      region: process.env.AWS_REGION ?? "us-east-2",
    });
    const out: number[][] = [];
    for (const text of texts) {
      const res = await client.send(
        new InvokeModelCommand({
          modelId: "amazon.titan-embed-text-v2:0",
          contentType: "application/json",
          accept: "application/json",
          body: JSON.stringify({ inputText: text.slice(0, 8000), dimensions: 1024 }),
        })
      );
      const body = JSON.parse(new TextDecoder().decode(res.body));
      out.push(body.embedding as number[]);
    }
    return out;
  }
}

class LocalMiniLmProvider implements EmbeddingProvider {
  name = "local-multilingual-e5-small";
  dims = 384;
  private pipe: ((texts: string[], opts: object) => Promise<{ tolist(): number[][] }>) | null = null;

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.pipe) {
      // 可选依赖:npm i @xenova/transformers 后即可离线使用。
      // 变量化的模块名避免打包器在编译期解析这个未安装的包。
      const modName = ["@xenova", "transformers"].join("/");
      const { pipeline } = await import(modName);
      this.pipe = await pipeline("feature-extraction", "Xenova/multilingual-e5-small");
    }
    const output = await this.pipe!(texts.map((t) => `query: ${t.slice(0, 2000)}`), {
      pooling: "mean",
      normalize: true,
    });
    return output.tolist();
  }
}

let cached: EmbeddingProvider | null | undefined;

export function getEmbeddingProvider(): EmbeddingProvider | null {
  if (cached !== undefined) return cached;
  const kind = process.env.EMBEDDINGS_PROVIDER ?? "none";
  cached =
    kind === "bedrock" ? new BedrockTitanProvider()
    : kind === "local" ? new LocalMiniLmProvider()
    : null;
  return cached;
}

export function cosineSim(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export function vecToBlob(v: number[]): Buffer {
  return Buffer.from(new Float32Array(v).buffer);
}

export function blobToVec(b: Buffer): Float32Array {
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}
