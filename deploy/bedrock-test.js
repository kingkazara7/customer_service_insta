// Quick Bedrock connectivity probe run on the EC2 instance
const { BedrockRuntimeClient, ConverseCommand } = require("@aws-sdk/client-bedrock-runtime");

const ids = [
  "us.anthropic.claude-sonnet-4-6",
  "us.anthropic.claude-opus-4-8",
];

(async () => {
  const c = new BedrockRuntimeClient({ region: process.env.AWS_REGION || "us-east-2" });
  for (const id of ids) {
    try {
      const r = await c.send(new ConverseCommand({
        modelId: id,
        messages: [{ role: "user", content: [{ text: "Say OK" }] }],
        inferenceConfig: { maxTokens: 10 },
      }));
      console.log("WORKS:", id, "->", r.output.message.content[0].text);
    } catch (e) {
      console.log("FAIL:", id, "->", e.name, e.message.slice(0, 120));
    }
  }
})();
