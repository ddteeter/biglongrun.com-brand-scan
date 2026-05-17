import { z } from "zod";

const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  FIRECRAWL_API_KEY: z.string().min(1),
  PUSHOVER_USER_KEY: z.string().min(1),
  PUSHOVER_APP_TOKEN: z.string().min(1),
  BLOG_API_TOKEN: z.string().min(16),
  ADMIN_PASSWORD_HASH: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  DATABASE_PATH: z.string().min(1),
  ARTIFACTS_PATH: z.string().min(1),
  PUBLIC_BASE_URL: z.url(),
  FIRECRAWL_MONTHLY_PAGE_BUDGET: z.coerce.number().int().positive(),
  ANTHROPIC_MONTHLY_USD_BUDGET: z.coerce.number().positive(),
  BUN_ENV: z.enum(["development", "production", "test"]).default("development"),
  USE_REAL_APIS: z
    .union([z.literal("0"), z.literal("1"), z.literal("true"), z.literal("false")])
    .default("0")
    .transform((v) => v === "1" || v === "true"),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(raw: Record<string, string | undefined>): Env {
  return EnvSchema.parse(raw);
}

let _env: Env | null = null;
export function getEnv(): Env {
  _env ??= parseEnv(process.env);
  return _env;
}
