import { eq } from "drizzle-orm";
import type { DB } from "../../infrastructure/db";
import { brands, brandSources } from "../../infrastructure/db/schema";
import { brandSlugFromName, resolveSlugCollision } from "./slug";
import { NewBrandInputSchema, NewBrandSourceInputSchema } from "./types";

export class BrandService {
  constructor(private readonly db: DB) {}

  async list() {
    return this.db.select().from(brands).orderBy(brands.name);
  }

  async findBySlug(slug: string) {
    const [row] = await this.db.select().from(brands).where(eq(brands.slug, slug)).limit(1);
    return row ?? null;
  }

  async findById(id: number) {
    const [row] = await this.db.select().from(brands).where(eq(brands.id, id)).limit(1);
    return row ?? null;
  }

  async create(raw: unknown): Promise<{ id: number; slug: string }> {
    const input = NewBrandInputSchema.parse(raw);
    const baseSlug = brandSlugFromName(input.name);
    const existingRows = await this.db.select({ slug: brands.slug }).from(brands);
    const existing = new Set(existingRows.map((r) => r.slug));
    const slug = resolveSlugCollision(baseSlug, existing);
    const [row] = await this.db
      .insert(brands)
      .values({
        slug,
        name: input.name,
        primaryUrl: input.primaryUrl,
        categoryTag: input.categoryTag,
      })
      .returning({ id: brands.id, slug: brands.slug });
    if (!row) throw new Error("insert failed to return row");
    return row;
  }
}

export class BrandSourceService {
  constructor(private readonly db: DB) {}

  async listForBrand(brandId: number) {
    return this.db.select().from(brandSources).where(eq(brandSources.brandId, brandId));
  }

  async create(raw: unknown): Promise<{ id: number }> {
    const input = NewBrandSourceInputSchema.parse(raw);
    const [row] = await this.db
      .insert(brandSources)
      .values({
        brandId: input.brandId,
        url: input.url,
        sourceType: input.sourceType,
      })
      .returning({ id: brandSources.id });
    if (!row) throw new Error("insert failed to return row");
    return row;
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(brandSources).where(eq(brandSources.id, id));
  }
}
