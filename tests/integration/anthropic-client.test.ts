import { describe, test, expect } from "bun:test";
import {
  AnthropicClient,
  MODEL_SONNET,
  MODEL_HAIKU,
} from "../../src/infrastructure/external/anthropic";

class FakeSdkClient {
  // Mirror the SDK shape we use.
  messages = {
    create: (req: { model: string; messages: unknown[]; max_tokens: number }) =>
      Promise.resolve({
        content: [
          {
            type: "text",
            text: JSON.stringify({ extracted: true, raw_model: req.model }),
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
  };
}

describe("AnthropicClient", () => {
  test("extractStructured returns parsed JSON and usage", async () => {
    const sdk = new FakeSdkClient();
    const client = new AnthropicClient({ apiKey: "test", sdkOverride: sdk as never });
    const r = await client.extractStructured({
      model: MODEL_SONNET,
      systemPrompt: "extract",
      userText: "input",
      maxTokens: 1024,
    });
    expect(r.parsed).toEqual({ extracted: true, raw_model: MODEL_SONNET });
    expect(r.usage.inputTokens).toBe(100);
    expect(r.usage.outputTokens).toBe(50);
  });

  test("model constants are stable IDs", () => {
    expect(MODEL_SONNET).toBe("claude-sonnet-4-6");
    expect(MODEL_HAIKU).toBe("claude-haiku-4-5-20251001");
  });
});
