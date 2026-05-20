import { desc, eq } from "drizzle-orm";
import type { DB } from "../../infrastructure/db";
import { authorBrandAssessments } from "../../infrastructure/db/schema";
import { NewAssessmentInputSchema, UpdateAssessmentInputSchema } from "./types";

export class AuthorAssessmentService {
  constructor(private readonly db: DB) {}

  async create(raw: unknown): Promise<number> {
    const input = NewAssessmentInputSchema.parse(raw);
    const insertValues: typeof authorBrandAssessments.$inferInsert = {
      brandId: input.brandId,
      authorSlug: input.authorSlug,
      ratingsJson: input.ratings,
      proseMarkdown: input.proseMarkdown,
    };
    if (input.assessmentDate !== undefined) {
      insertValues.assessmentDate = input.assessmentDate;
    }
    const [row] = await this.db
      .insert(authorBrandAssessments)
      .values(insertValues)
      .returning({ id: authorBrandAssessments.id });
    if (!row) throw new Error("assessment insert returned empty");
    return row.id;
  }

  async update(raw: unknown): Promise<void> {
    const input = UpdateAssessmentInputSchema.parse(raw);
    const set: Partial<typeof authorBrandAssessments.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };
    if (input.ratings !== undefined) set.ratingsJson = input.ratings;
    if (input.proseMarkdown !== undefined) set.proseMarkdown = input.proseMarkdown;
    await this.db
      .update(authorBrandAssessments)
      .set(set)
      .where(eq(authorBrandAssessments.id, input.id));
  }

  async findById(id: number) {
    const [row] = await this.db
      .select()
      .from(authorBrandAssessments)
      .where(eq(authorBrandAssessments.id, id))
      .limit(1);
    return row ?? null;
  }

  async listForBrand(brandId: number) {
    return this.db
      .select()
      .from(authorBrandAssessments)
      .where(eq(authorBrandAssessments.brandId, brandId))
      .orderBy(desc(authorBrandAssessments.assessmentDate));
  }

  async listAll() {
    return this.db
      .select()
      .from(authorBrandAssessments)
      .orderBy(desc(authorBrandAssessments.assessmentDate));
  }
}
