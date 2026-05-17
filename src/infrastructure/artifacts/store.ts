import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export class ArtifactStore {
  constructor(private readonly basePath: string) {}

  async save(
    bytes: Uint8Array,
    runId: number,
    ext: string
  ): Promise<{ filePath: string; sha256: string }> {
    await mkdir(this.basePath, { recursive: true });
    const filename = `${String(runId)}.${ext}`;
    const fullPath = path.join(this.basePath, filename);
    await writeFile(fullPath, bytes);
    const sha = createHash("sha256").update(bytes).digest("hex");
    return { filePath: filename, sha256: sha };
  }
}
