import { describe, test, expect } from "bun:test";
import { extractWithClaude } from "../../src/domain/extraction/extractor-claude";
import { AnthropicClient } from "../../src/infrastructure/external/anthropic";

class FakeSdk {
  messages = {
    create: () =>
      Promise.resolve({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              chart: {
                size_labels: ["S", "M"],
                measurements: {
                  S: { chest_in: [36, 38], waist_in: [28, 30], hip_in: [36, 38] },
                  M: { chest_in: [38, 40], waist_in: [30, 32], hip_in: [38, 40] },
                },
                size_availability: [],
                notes: "",
                gender_specific: "unisex",
              },
              overall_confidence: 0.92,
              per_field_confidence: { S: 0.95, M: 0.9 },
              what_i_saw: "Standard unisex table on the page.",
            }),
          },
        ],
        usage: { input_tokens: 200, output_tokens: 100 },
      }),
  };
}

describe("extractWithClaude", () => {
  test("returns canonical chart + reported confidence + usage", async () => {
    const client = new AnthropicClient({ apiKey: "test", sdkOverride: new FakeSdk() as never });
    const r = await extractWithClaude({
      client,
      sourceUrl: "https://brand.com/size",
      markdown: "(rendered markdown)",
      screenshotPng: new Uint8Array([0]),
      priorContext: { lastAccepted: null, assessments: [], corrections: [] },
    });
    expect(r.chart.method).toBe("claude");
    expect(r.chart.measurements.M?.chest_in).toEqual([38, 40]);
    expect(r.reportedConfidence).toBe(0.92);
    expect(r.usage.inputTokens).toBe(200);
    expect(r.whatISaw).toContain("Standard");
  });
});
