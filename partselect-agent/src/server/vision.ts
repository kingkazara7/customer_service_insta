/**
 * Vision: read the MODEL NUMBER off an appliance nameplate photo.
 *
 * Deliberately scoped to one reliable task. Reading a printed model number from
 * a rating-plate sticker is essentially OCR — fast and accurate. Identifying a
 * specific part from a photo of the part is NOT reliable for any vision model
 * (appliance parts look alike and the photo carries no part number), so we do
 * not attempt it; we ask the user to type the part number instead.
 *
 * Uses Bedrock Converse directly (cleaner image support than routing images
 * through the Agent SDK). Degrades gracefully when no LLM is configured.
 */

export type VisionResult =
  | { kind: "model"; modelNo: string; note?: string }
  | { kind: "unclear"; reason: string };

export type ImageInput = {
  base64: string; // raw base64, no data: prefix
  format: "jpeg" | "png" | "gif" | "webp";
};

function bedrockAvailable(): boolean {
  return process.env.CLAUDE_CODE_USE_BEDROCK === "1";
}

const VISION_PROMPT = `You are helping a PartSelect customer who photographed their appliance. PartSelect sells REFRIGERATOR and DISHWASHER parts only.

Your ONLY job is to read the MODEL NUMBER from the photo — usually printed on the appliance's nameplate / rating-plate sticker, labeled "MODEL" or "MODEL NO." Read that value, NOT the serial number. Model numbers look like WDT780SAEM1, WRS325SDHZ01, MDB4949SHZ.

Respond with EXACTLY ONE line:
MODEL: <model number>          — if you can clearly read a model number
UNCLEAR: <one short reason>    — if there is no readable model number, or it's clearly not a refrigerator/dishwasher

Do NOT guess a part's identity from how it looks. Output only that one line, nothing else.`;

const MODEL_RE = /\b[A-Z]{2,4}\d{3}[A-Z0-9]{2,9}\b/;

export async function identifyImage(image: ImageInput): Promise<VisionResult> {
  if (!bedrockAvailable()) {
    return {
      kind: "unclear",
      reason: "Photo recognition isn't available right now — please type your model number (on the nameplate) or the part number.",
    };
  }
  try {
    const { BedrockRuntimeClient, ConverseCommand } = await import(
      "@aws-sdk/client-bedrock-runtime"
    );
    const client = new BedrockRuntimeClient({
      region: process.env.AWS_REGION ?? "us-east-2",
    });
    const bytes = Uint8Array.from(Buffer.from(image.base64, "base64"));
    const res = await client.send(
      new ConverseCommand({
        modelId:
          process.env.VISION_MODEL ??
          process.env.AGENT_MODEL ??
          "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        messages: [
          {
            role: "user",
            content: [
              { image: { format: image.format, source: { bytes } } },
              { text: VISION_PROMPT },
            ],
          },
        ],
        inferenceConfig: { maxTokens: 100, temperature: 0 },
      })
    );
    const text =
      res.output?.message?.content?.find((c) => "text" in c)?.text?.trim() ?? "";
    return parseVision(text);
  } catch (err) {
    console.error("identifyImage failed:", err);
    return {
      kind: "unclear",
      reason: "I couldn't read that photo — please type your model number or the part number.",
    };
  }
}

function parseVision(text: string): VisionResult {
  const model = text.match(/MODEL:\s*(.+)/i);
  if (model) {
    const mm = model[1].match(MODEL_RE);
    if (mm) return { kind: "model", modelNo: mm[0].toUpperCase() };
    return { kind: "model", modelNo: model[1].trim().toUpperCase() };
  }
  const unclear = text.match(/UNCLEAR:\s*(.+)/i);
  return {
    kind: "unclear",
    reason: unclear?.[1]?.trim()
      ?? "I couldn't read a model number from that photo. Try a clearer shot of the nameplate, or type your model or part number.",
  };
}
