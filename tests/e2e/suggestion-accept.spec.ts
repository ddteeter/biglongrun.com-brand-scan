import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test("suggestion accept promotes to brand and redirects to brand page", async ({ page }) => {
  await login(page);
  await page.goto("/admin/suggestions");

  // If there are no pending suggestions, skip gracefully.
  const rows = page.locator("table tbody tr");
  const rowCount = await rows.count();
  test.skip(rowCount === 0, "no pending suggestions seeded");

  // Pick the first row's accept-form URL input and fill it.
  const firstRow = rows.first();
  const urlInput = firstRow.locator('form[action*="/accept"] input[name="primaryUrl"]');
  await urlInput.fill("https://example.com");

  // Read the brand name from the first row before submitting.
  const brandNameCell = firstRow.locator("td").nth(1);
  const brandName = await brandNameCell.textContent();

  // Click the Accept button in the first row's accept form.
  const acceptButton = firstRow.locator('form[action*="/accept"] button[type="submit"]');
  await acceptButton.click();

  // After redirect, URL should match /admin/brands/<slug>.
  await page.waitForURL(/\/admin\/brands\//);
  expect(page.url()).toMatch(/\/admin\/brands\/[a-z0-9-]+$/);

  // The brand name from the suggestion should appear on the brand page.
  if (brandName) {
    await expect(page.locator("body")).toContainText(brandName.trim());
  }
});
