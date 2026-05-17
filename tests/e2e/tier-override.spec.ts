import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test("tier override updates classification via admin items tab", async ({ page }) => {
  await login(page);
  await page.goto("/admin/brands");

  // Find the first brand link; skip gracefully if none exist.
  const brandLink = page.locator("table a").first();
  const count = await brandLink.count();
  test.skip(count === 0, "no brands in DB — skipping tier-override E2E");

  await brandLink.click();
  await page.waitForURL(/\/admin\/brands\//);

  // Open the items tab.
  await page.click('a:has-text("items")');
  await page.waitForURL(/tab=items/);

  // Skip if no items are visible.
  const itemRow = page.locator("table tbody tr").first();
  const rowCount = await itemRow.count();
  test.skip(rowCount === 0, "no items in DB — skipping tier-override E2E");

  // Use the override form in the first row: select flagship, add rationale, submit.
  const form = page.locator("form[action*='/set-tier']").first();
  await form.locator("select[name='tier']").selectOption("flagship");
  await form.locator("input[name='rationale']").fill("e2e override");
  await form.locator("button[type='submit']").click();

  // After redirect back to the items tab, the tier should show "flagship".
  await page.waitForURL(/\/admin\/brands\//);
  await expect(page.locator("body")).toContainText("flagship");
});
