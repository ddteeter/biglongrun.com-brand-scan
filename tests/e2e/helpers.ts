import { type Page, expect } from "@playwright/test";

export async function login(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await page.fill('input[name="password"]', "e2e-password");
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL("/admin");
}
