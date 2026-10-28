import { expect, test } from "@playwright/test";
import { SHARED_STATE } from "./global-setup";

test.use({ storageState: SHARED_STATE });

test("a user logs an application, changes its status, and deletes it", async ({ page }) => {
  const role = `E2E Analyst ${Date.now().toString(36)}`;
  await page.goto("/dashboard");
  await page.getByLabel("Company").selectOption({ label: "Quietwater Logistics" });
  await page.getByLabel("Role title").fill(role);
  await page.getByLabel("This is my own first-hand experience applying for this role.").check();
  await page.getByRole("button", { name: "Log application" }).click();

  const status = page.getByLabel(`Status for ${role} at Quietwater Logistics`);
  await expect(status).toHaveValue("APPLIED");
  await status.selectOption({ label: "No response" });
  // The status saves on blur (or after a short pause): wait for that save before reloading.
  const saved = page.waitForResponse((r) => r.url().includes("/api/v1/reports/") && r.request().method() === "PATCH" && r.ok());
  await status.blur();
  await saved;
  await page.reload();
  await expect(page.getByLabel(`Status for ${role} at Quietwater Logistics`)).toHaveValue("NO_RESPONSE");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: `Delete ${role} at Quietwater Logistics` }).click();
  await expect(page.getByLabel(`Status for ${role} at Quietwater Logistics`)).toHaveCount(0);
});
