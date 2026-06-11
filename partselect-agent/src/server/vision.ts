/**
 * Vision: identify an appliance model sticker or a part from a user photo.
 *
 * Appliance model/serial stickers are notoriously hard to type correctly, and
 * customers often don't know a part's name — so letting them photograph the
 * nameplate or the broken part is the most natural input in this domain.
 *
 * Uses Bedrock Converse directly (cleaner image support than routing images
 * through the Agent SDK). Degrades gracefully when no LLM is configured.
 */

export type VisionResult =
  | { kind: "model"; modelNo: string; note?: string }
  | { kind: "part"; description: string; applianceType?: "refrigerator" | "dishwasher" }
  | { kind: "unclear"; reason: string };

export type ImageInput = {
  base64: string; // raw base64, no data: prefix
  format: "jpeg" | "png" | "gif" | "webp";
};

function bedrockAvailable(): boolean {
  return process.env.CLAUDE_CODE_USE_BEDROCK === "1";
}

const VISION_PROMPT = `You are helping a PartSelect customer who sent a photo. PartSelect sells REFRIGERATOR and DISHWASHER parts only.

The photo is most likely one of:
1. An appliance model/serial nameplate sticker — read the MODEL NUMBER (not the serial number). Model numbers look like WDT780SAEM1, WRS325SDHZ01, MDB4949SHZ.
2. A broken or worn part — identify what the part is and which appliance it belongs to.

Respond with EXACTLY ONE line, one of these forms:
MODEL: <model number>
PART: <short description of the part> | <refrigerator OR dishwasher>
UNCLEAR: <one short reason>

If the photo clearly shows something that is NOT a refrigerator or dishwasher (or their parts), respond:
UNCLEAR: This doesn't look like a refrigerator or dishwasher part.

Output only that one line, nothing else.`;

const MODEL_RE = /\b[A-Z]{2,4}\d{3}[A-Z0-9]{2,9}\b/;

export async function identifyImage(image: ImageInput): Promise<VisionResult> {
  if (!bedrockAvailable()) {
    return {
      kind: "unclear",
      reason: "Image recognition isn't available right now — please type your model number (on the nameplate) or describe the part.",
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
      reason: "I couldn't read that image — please type your model number or describe the part.",
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
  const part = text.match(/PART:\s*(.+)/i);
  if (part) {
    const [desc, appl] = part[1].split("|").map((s) => s.trim());
    const applianceType =
      /fridge|refriger/i.test(appl ?? "") ? "refrigerator"
      : /dish/i.test(appl ?? "") ? "dishwasher"
      : undefined;
    return { kind: "part", description: desc, applianceType };
  }
  const unclear = text.match(/UNCLEAR:\s*(.+)/i);
  return {
    kind: "unclear",
    reason: unclear?.[1]?.trim() ?? "I couldn't tell what's in that photo — please type your model number or describe the part.",
  };
}
