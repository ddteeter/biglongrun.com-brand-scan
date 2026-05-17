import { runMigrations } from "../src/infrastructure/db/migrate";
import { getDb } from "../src/infrastructure/db";
import { BrandRepo, BrandSourceRepo } from "../src/domain/brands";

runMigrations();
const db = getDb();
const brands = new BrandRepo(db);
const sources = new BrandSourceRepo(db);

const seeds: { name: string; url: string; sizeUrl: string }[] = [
  {
    name: "Tracksmith",
    url: "https://tracksmith.com",
    sizeUrl: "https://tracksmith.com/pages/size-chart",
  },
  {
    name: "Path Projects",
    url: "https://pathprojects.com",
    sizeUrl: "https://pathprojects.com/pages/size-chart",
  },
  { name: "Janji", url: "https://janji.com", sizeUrl: "https://janji.com/pages/size-chart" },
];

for (const s of seeds) {
  const created = await brands.create({ name: s.name, primaryUrl: s.url });
  await sources.create({ brandId: created.id, url: s.sizeUrl, sourceType: "size_chart" });
  console.log(`seeded ${created.slug}`);
}
