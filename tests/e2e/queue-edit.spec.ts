import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test("queue edit textarea accepts new JSON before submission", async ({ page }) => {
  await login(page);
  await page.goto("/admin/queue");
  const textarea = page.locator('textarea[name="size_chart_json"]').first();
  if (await textarea.isVisible()) {
    await textarea.fill('{"size_labels":["S"],"measurements":{}}');
    await expect(textarea).toHaveValue(/size_labels/);
  } else {
    test.skip(true, "no queue items to edit");
  }
});
