import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test("assessment create saves a new assessment row", async ({ page }) => {
  await login(page);
  await page.goto("/admin/brands");

  // Find the first brand link; skip gracefully if none exist.
  const brandLink = page.locator("table a").first();
  const count = await brandLink.count();
  test.skip(count === 0, "no brands in DB — skipping assessment-create E2E");

  await brandLink.click();
  await page.waitForURL(/\/admin\/brands\//);

  // Open the assessments tab via its direct URL to avoid nav ambiguity.
  const brandUrl = page.url();
  await page.goto(`${brandUrl}?tab=assessments`);
  await page.waitForURL(/tab=assessments/);

  // Expand the "Add new assessment" details element.
  await page.click('details summary:has-text("Add new assessment")');

  // Fill the 5 rating inputs.
  await page.fill('input[name="rating_size_options"]', "7");
  await page.fill('input[name="rating_tier_equity"]', "6");
  await page.fill('input[name="rating_pricing_equity"]', "8");
  await page.fill('input[name="rating_fit_label_honesty"]', "5");
  await page.fill('input[name="rating_overall_inclusivity"]', "7");

  // Fill the prose textarea with recognizable text.
  const proseText = "E2E assessment prose content for verification";
  await page.fill('textarea[name="proseMarkdown"]', proseText);

  // Submit the form.
  await page.click('button[type="submit"]:has-text("Save assessment")');

  // After redirect, the assessments tab should show the new row.
  await page.waitForURL(/\/admin\/brands\//);

  // Verify the saved assessment appears in the table.
  await expect(page.locator("body")).toContainText("E2E assessment prose");
});
