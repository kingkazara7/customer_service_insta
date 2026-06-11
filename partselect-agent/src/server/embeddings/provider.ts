/**
 * Embedding provider abstraction:
 *  - bedrock: Amazon Titan Text Embeddings v2 (1024-dim; recommended in prod/EC2)
 *  - local:   @xenova/transformers local model (384-dim; offline dev, optional dependency)
 *  - none:    unavailable → RAG automatically falls back to keyword retrieval
 * Selected via the EMBEDDINGS_PROVIDER env var. Only body text gets embedded —
 * links and metadata stay as plain columns.
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
      // Optional dependency: `npm i @xenova/transformers` enables offline embeddings.
      // The computed module name keeps bundlers from resolving this uninstalled package.
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
