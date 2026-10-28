import { expect, test } from "@playwright/test";
import { SHARED_STATE } from "./global-setup";

test.use({ storageState: SHARED_STATE });

test("a user sends a problem report about the site and gets a reference", async ({ page, baseURL }) => {
  await page.goto("/report-a-problem");
  await page.getByRole("radio", { name: /Something about the site/ }).check();
  await page.getByLabel(/What.s wrong\?/).selectOption({ label: "Something else" });
  await page.getByLabel("Details").fill("Automated end-to-end test report. Safe to reject.");
  await page.getByRole("button", { name: "Send report" }).click();

  const done = page.getByRole("heading", { name: /Thanks, we.ve got it/ });
  await expect(done).toBeVisible();
  const reference = (await page.locator("section", { has: done }).getByRole("code").textContent())?.trim();
  expect(reference).toBeTruthy();

  // Leave nothing in the admin's open queue: close the report as the admin when we can.
  const password = process.env.ADMIN_USER_PASSWORD;
  if (password && reference) {
    const admin = await page.context().browser()!.newContext({ baseURL });
    const login = await admin.request.post("/api/auth/login", { headers: { origin: baseURL! }, data: { username: "admin", password } });
    if (login.ok()) {
      await admin.request.patch(`/api/v1/flags/${reference}`, {
        headers: { origin: baseURL!, "content-type": "application/json" },
        data: { status: "REJECTED", resolutionNote: "Automated end-to-end test." },
      });
    }
    await admin.close();
  }
});
