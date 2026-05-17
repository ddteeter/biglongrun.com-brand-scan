import { createHash } from "node:crypto";

export function computeEtag(body: string | Uint8Array): string {
  const data = typeof body === "string" ? body : Buffer.from(body);
  return `"${createHash("sha256").update(data).digest("hex").slice(0, 16)}"`;
}

export function cacheHeaders(
  maxAgeSeconds: number,
  etag: string,
  lastModified?: Date
): Record<string, string> {
  const h: Record<string, string> = {
    "cache-control": `public, max-age=${String(maxAgeSeconds)}`,
    etag,
  };
  if (lastModified) h["last-modified"] = lastModified.toUTCString();
  return h;
}

export function notModified(reqEtag: string | null, etag: string): boolean {
  if (!reqEtag) return false;
  return (
    reqEtag === etag ||
    reqEtag
      .split(",")
      .map((s) => s.trim())
      .includes(etag)
  );
}
