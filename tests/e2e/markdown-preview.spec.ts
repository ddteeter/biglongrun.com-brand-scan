import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test("markdown editor live preview renders heading and bold", async ({ page }) => {
  await login(page);
  await page.goto("/admin/brands");

  // Find the first brand link; skip gracefully if none exist.
  const brandLink = page.locator("table a").first();
  const count = await brandLink.count();
  test.skip(count === 0, "no brands in DB — skipping markdown-preview E2E");

  await brandLink.click();
  await page.waitForURL(/\/admin\/brands\//);

  // Open the assessments tab via its direct URL to avoid nav ambiguity.
  const brandUrl = page.url();
  await page.goto(`${brandUrl}?tab=assessments`);
  await page.waitForURL(/tab=assessments/);

  // Expand the "Add new assessment" details element to reveal the textarea.
  await page.click('details summary:has-text("Add new assessment")');

  // Type markdown into the prose textarea — HTMX posts on input with delay:300ms.
  await page.fill('textarea[name="proseMarkdown"]', "# Hello\n\n**bold**");

  // Wait for the HTMX debounce (300ms) plus network round-trip and render.
  await page.waitForTimeout(800);

  // The preview pane should contain the rendered heading text and bold element.
  const preview = page.locator("#assessment-prose-preview");
  await expect(preview).toContainText("Hello");
  await expect(preview.locator("strong")).toContainText("bold");
});
