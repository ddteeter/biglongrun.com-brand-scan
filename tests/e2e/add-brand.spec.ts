import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test("add brand creates row and redirects to detail", async ({ page }) => {
  await login(page);
  await page.goto("/admin/brands");
  await page.locator("summary", { hasText: "Add brand" }).click();
  await page.fill('input[name="name"]', "Test Brand");
  await page.fill('input[name="primaryUrl"]', "https://test.example.com");
  await page.click('button[type="submit"]:has-text("Create brand")');
  await expect(page).toHaveURL(/\/admin\/brands\/test-brand/);
  await expect(page.locator("h1")).toContainText("Test Brand");
});
