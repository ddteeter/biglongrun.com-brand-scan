import { readdir, readFile } from "node:fs/promises";
import nodePath from "node:path";

export interface BlogReviewParsed {
  /** File path of the source .mdx / .md file */
  filePath: string;
  brand: string;
  date: string;
  author: string;
  reviewUrl: string | null;
  sizeOptionsRating: number | null;
  sizeOptionsSummary: string | null;
}

type ScalarValue = string | number | null;

/**
 * Parse a scalar YAML value: strip quotes, coerce numbers.
 * Always returns ScalarValue (string | number | null).
 */
function parseScalar(raw: string): ScalarValue {
  let result: ScalarValue = raw;

  if (raw === "null" || raw === "~") {
    result = null;
  } else if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    // Quoted string — strip surrounding quotes
    result = raw.slice(1, -1);
  } else {
    // Number
    const num = Number(raw);
    if (!Number.isNaN(num) && raw !== "") result = num;
  }

  return result;
}

/**
 * Collect indented child lines and return a nested object.
 * Returns [object, newIndex] where newIndex is the next line to process.
 */
function parseNestedBlock(
  lines: string[],
  startIndex: number
): [Record<string, ScalarValue>, number] {
  const nested: Record<string, ScalarValue> = {};
  let i = startIndex;
  while (i < lines.length) {
    const childLine = lines[i] ?? "";
    if (childLine.trim() === "") {
      i++;
      continue;
    }
    const childIndent = childLine.search(/\S/);
    if (childIndent === 0) break; // back to top level
    const childColonIdx = childLine.indexOf(":");
    if (childColonIdx === -1) {
      i++;
      continue;
    }
    const childKey = childLine.slice(childIndent, childColonIdx).trim();
    const childValue = childLine.slice(childColonIdx + 1).trim();
    nested[childKey] = parseScalar(childValue);
    i++;
  }
  return [nested, i];
}

function parseYamlLines(lines: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.trim() === "" || line.search(/\S/) !== 0) {
      i++;
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      i++;
      continue;
    }

    const key = line.slice(0, colonIdx).trim();
    const valuePart = line.slice(colonIdx + 1).trim();

    if (valuePart === "" || valuePart === "|" || valuePart === ">") {
      const [nested, nextIndex] = parseNestedBlock(lines, i + 1);
      result[key] = nested;
      i = nextIndex;
    } else {
      result[key] = parseScalar(valuePart);
      i++;
    }
  }
  return result;
}

/**
 * Minimal indentation-aware YAML frontmatter parser for the known blog review schema.
 * Handles scalar values and one level of nested objects (e.g. sizeOptions).
 * Does NOT pull in a YAML library.
 */
function parseFrontmatter(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---")) return null;

  const afterOpen = trimmed.slice(3);
  const closeIndex = afterOpen.indexOf("\n---");
  if (closeIndex === -1) return null;

  return parseYamlLines(afterOpen.slice(0, closeIndex).split("\n"));
}

/** Coerce the raw YAML date field to a YYYY-MM-DD string. */
function coerceDate(raw: unknown): string {
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  if (typeof raw === "string") return raw;
  return "";
}

/** Extract sizeOptions from a frontmatter record. */
function extractSizeOptions(fm: Record<string, unknown>): {
  sizeOptionsRating: number | null;
  sizeOptionsSummary: string | null;
} {
  const sizeOpts = fm.sizeOptions;
  if (sizeOpts === null || typeof sizeOpts !== "object" || Array.isArray(sizeOpts)) {
    return { sizeOptionsRating: null, sizeOptionsSummary: null };
  }
  const opts = sizeOpts as Record<string, unknown>;
  return {
    sizeOptionsRating: typeof opts.rating === "number" ? opts.rating : null,
    sizeOptionsSummary: typeof opts.summary === "string" ? opts.summary : null,
  };
}

/** Parse a single .mdx/.md file and return a BlogReviewParsed, or null if it should be skipped. */
async function parseReviewFile(filePath: string): Promise<BlogReviewParsed | null> {
  const content = await readFile(filePath, "utf8");
  const fm = parseFrontmatter(content);
  if (!fm || typeof fm.brand !== "string") return null;

  const { sizeOptionsRating, sizeOptionsSummary } = extractSizeOptions(fm);

  return {
    filePath,
    brand: fm.brand,
    date: coerceDate(fm.date),
    author: typeof fm.author === "string" ? fm.author : "",
    reviewUrl: typeof fm.reviewUrl === "string" ? fm.reviewUrl : null,
    sizeOptionsRating,
    sizeOptionsSummary,
  };
}

/**
 * Recursively parse all `.mdx` / `.md` files in `reviewsDirAbsPath`.
 * Skips files with no `brand:` field in frontmatter.
 */
export async function parseBlogReviewsDir(reviewsDirAbsPath: string): Promise<BlogReviewParsed[]> {
  const entries = await readdir(reviewsDirAbsPath, { recursive: true, withFileTypes: true });

  const results: BlogReviewParsed[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const { name } = entry;
    if (!name.endsWith(".mdx") && !name.endsWith(".md")) continue;

    // Bun sets parentPath when reading from an absolute path
    const dir = entry.parentPath || reviewsDirAbsPath;
    const filePath = nodePath.join(dir, name);

    const review = await parseReviewFile(filePath);
    if (review) results.push(review);
  }

  return results;
}
