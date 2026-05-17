import { runMigrations } from "../src/infrastructure/db/migrate";
import { getDb } from "../src/infrastructure/db";
import { BrandService, BrandSourceService } from "../src/domain/brands";
import type { brands, brandSources } from "../src/infrastructure/db/schema";

runMigrations();
const db = getDb();
const brandRepo = new BrandService(db);
const sourceRepo = new BrandSourceService(db);

type Seed = Pick<typeof brands.$inferInsert, "name" | "primaryUrl"> & {
  sizeChartUrl: typeof brandSources.$inferInsert.url;
};

const seeds: Seed[] = [
  {
    name: "Tracksmith",
    primaryUrl: "https://tracksmith.com",
    sizeChartUrl: "https://tracksmith.com/pages/size-chart",
  },
  {
    name: "Path Projects",
    primaryUrl: "https://pathprojects.com",
    sizeChartUrl: "https://pathprojects.com/pages/size-chart",
  },
  {
    name: "Janji",
    primaryUrl: "https://janji.com",
    sizeChartUrl: "https://janji.com/pages/size-chart",
  },
];

for (const s of seeds) {
  const created = await brandRepo.create({ name: s.name, primaryUrl: s.primaryUrl });
  await sourceRepo.create({ brandId: created.id, url: s.sizeChartUrl, sourceType: "size_chart" });
  console.log(`seeded ${created.slug}`);
}
