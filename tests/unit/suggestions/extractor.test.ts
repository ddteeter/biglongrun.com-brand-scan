import { describe, test, expect } from "bun:test";
import { extractBrandMentions } from "../../../src/domain/suggestions/extractor";
import { type AnthropicClient, MODEL_HAIKU } from "../../../src/infrastructure/external";
import type { RedditPost } from "../../../src/domain/suggestions/reddit-client";

const SAMPLE_POST: RedditPost = {
  id: "t3_abc123",
  subreddit: "running",
  title: "Best running gear 2024?",
  selftext: "I love Tracksmith and Path Projects for long runs.",
  url: "https://www.reddit.com/r/running/comments/abc123/",
  publishedAt: "2024-01-15T10:00:00+00:00",
};

const PLUS_SIZE_POST: RedditPost = {
  id: "t3_psz999",
  subreddit: "PlusSizeFitness",
  title: "Plus size running gear recommendations?",
  selftext: "Looking for brands that cater to plus size runners. Janji has great options!",
  url: "https://www.reddit.com/r/PlusSizeFitness/comments/psz999/",
  publishedAt: "2024-01-15T10:00:00+00:00",
};

function makeSdkStub(
  responseJson: object,
  capturedRequests?: { model?: string }[]
): Pick<AnthropicClient, "extractStructured"> {
  const stub = {
    extractStructured: (req: { model: string }) => {
      if (capturedRequests) capturedRequests.push({ model: req.model });
      return Promise.resolve({
        parsed: responseJson,
        rawText: JSON.stringify(responseJson),
        usage: { inputTokens: 120, outputTokens: 60 },
      });
    },
  } as unknown as AnthropicClient;
  return stub;
}

describe("extractBrandMentions", () => {
  test("parses a typical response into camelCase ExtractedCandidate[]", async () => {
    const response = {
      candidates: [
        {
          brand_name: "Tracksmith",
          context_excerpt: "I love Tracksmith for long runs.",
          plus_size_signal: false,
        },
        {
          brand_name: "Path Projects",
          context_excerpt: "Path Projects makes great shorts.",
          plus_size_signal: false,
        },
      ],
    };

    const client = makeSdkStub(response) as unknown as AnthropicClient;
    const result = await extractBrandMentions({ client, post: SAMPLE_POST });

    expect(result.candidates.length).toBe(2);
    expect(result.candidates[0]).toEqual({
      brandName: "Tracksmith",
      contextExcerpt: "I love Tracksmith for long runs.",
      plusSizeSignal: false,
    });
    expect(result.candidates[1]).toEqual({
      brandName: "Path Projects",
      contextExcerpt: "Path Projects makes great shorts.",
      plusSizeSignal: false,
    });
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 60 });
  });

  test("empty candidates array returns empty list", async () => {
    const response = { candidates: [] };
    const client = makeSdkStub(response) as unknown as AnthropicClient;
    const result = await extractBrandMentions({ client, post: SAMPLE_POST });

    expect(result.candidates).toEqual([]);
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 60 });
  });

  test("maps plus_size_signal to plusSizeSignal correctly", async () => {
    const response = {
      candidates: [
        {
          brand_name: "Janji",
          context_excerpt: "Janji has plus-size options!",
          plus_size_signal: true,
        },
        {
          brand_name: "Oiselle",
          context_excerpt: "Oiselle also mentioned.",
          plus_size_signal: false,
        },
      ],
    };

    const client = makeSdkStub(response) as unknown as AnthropicClient;
    const result = await extractBrandMentions({ client, post: PLUS_SIZE_POST });

    expect(result.candidates[0]?.plusSizeSignal).toBe(true);
    expect(result.candidates[1]?.plusSizeSignal).toBe(false);
  });

  test("uses MODEL_HAIKU for the API call", async () => {
    const capturedRequests: { model?: string }[] = [];
    const response = { candidates: [] };
    const client = makeSdkStub(response, capturedRequests) as unknown as AnthropicClient;

    await extractBrandMentions({ client, post: SAMPLE_POST });

    expect(capturedRequests.length).toBe(1);
    expect(capturedRequests[0]?.model).toBe(MODEL_HAIKU);
  });
});
