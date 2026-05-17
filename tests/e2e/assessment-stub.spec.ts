import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.skip("assessments page renders (phase 3)", async ({ page }) => {
  await login(page);
  await page.goto("/admin/assessments");
  await expect(page.locator("h1")).toContainText("Assessments");
});
