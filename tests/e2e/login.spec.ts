import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test("login renders dashboard", async ({ page }) => {
  await login(page);
  await expect(page.locator("h1")).toContainText("Dashboard");
});

test("wrong password shows error", async ({ page }) => {
  await page.goto("/admin/login");
  await page.fill('input[name="password"]', "wrong");
  await page.click('button[type="submit"]');
  await expect(page.locator("body")).toContainText("Invalid password");
});
