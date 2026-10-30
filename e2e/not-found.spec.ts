import { expect, test } from "@playwright/test";

test("an unknown address shows the 404 page with a way back", async ({ page }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page).toHaveTitle("Page not found · JobSeance");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nothing answered here.");
  await page.getByRole("link", { name: "Go to the home page" }).click();
  await expect(page.getByRole("form", { name: "Login" })).toBeVisible();
});
