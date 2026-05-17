import Anthropic from "@anthropic-ai/sdk";

export const MODEL_SONNET = "claude-sonnet-4-6" as const;
export const MODEL_HAIKU = "claude-haiku-4-5-20251001" as const;

export type ModelId = typeof MODEL_SONNET | typeof MODEL_HAIKU;

export interface ExtractRequest {
  model: ModelId;
  systemPrompt: string;
  userText: string;
  userImagePngBytes?: Uint8Array;
  maxTokens: number;
}

export interface ExtractResponse {
  parsed: unknown;
  rawText: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface AnthropicClientOptions {
  apiKey: string;
  sdkOverride?: Pick<Anthropic, "messages">;
}

export class AnthropicClient {
  private readonly sdk: Pick<Anthropic, "messages">;

  constructor(opts: AnthropicClientOptions) {
    this.sdk = opts.sdkOverride ?? new Anthropic({ apiKey: opts.apiKey });
  }

  async extractStructured(req: ExtractRequest): Promise<ExtractResponse> {
    const content: { type: string; text?: string; source?: Record<string, unknown> }[] = [
      { type: "text", text: req.userText },
    ];
    if (req.userImagePngBytes) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: Buffer.from(req.userImagePngBytes).toString("base64"),
        },
      });
    }
    const resp = (await this.sdk.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.systemPrompt,
      messages: [{ role: "user", content }],
    } as never)) as {
      content: { type: string; text?: string }[];
      usage: { input_tokens: number; output_tokens: number };
    };

    const textBlock = resp.content.find((b) => b.type === "text");
    const rawText = textBlock?.text ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonBlock(rawText));
    } catch (error) {
      throw new Error(`Failed to parse Claude JSON: ${(error as Error).message}\n---\n${rawText}`, {
        cause: error,
      });
    }
    return {
      parsed,
      rawText,
      usage: { inputTokens: resp.usage.input_tokens, outputTokens: resp.usage.output_tokens },
    };
  }
}

function extractJsonBlock(text: string): string {
  // Find opening ``` or ```json fence, then take everything up to the closing ```
  const openIdx = text.indexOf("```");
  if (openIdx === -1) return text.trim();
  const afterOpen = text.indexOf("\n", openIdx);
  if (afterOpen === -1) return text.trim();
  const closeIdx = text.indexOf("```", afterOpen);
  if (closeIdx === -1) return text.trim();
  return text.slice(afterOpen + 1, closeIdx).trim();
}
