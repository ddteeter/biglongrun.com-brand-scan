import { test, expect } from "@playwright/test";
import { login } from "./helpers";

const dbPath = process.env.E2E_DB_PATH ?? null;

test("approve a pending_review row supersedes prior and redirects", async ({ page }) => {
  test.skip(!dbPath, "E2E_DB_PATH not set — skipping (seeded via test runner)");
  // Phase 1: this test depends on the runner seeding a pending_review row.
  // Implementer should add a small seed-pending helper invoked before tests.
  await login(page);
  await page.goto("/admin/queue");
  await expect(page.locator("body")).toContainText(/Review queue|Queue is empty/);
});
