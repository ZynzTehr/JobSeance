import { expect, test } from "@playwright/test";
import { AUTOMATION_HEADERS, SHARED_STATE } from "./global-setup";

// Runs only when the seeded admin account's password is available (ADMIN_USER_PASSWORD in .env).
const password = process.env.ADMIN_USER_PASSWORD;

test("the admin sees the admin page; a plain user gets a 404", async ({ browser, baseURL }) => {
  test.skip(!password, "ADMIN_USER_PASSWORD is not set, so there is no admin account to sign in as.");

  const admin = await browser.newContext({ baseURL });
  const login = await admin.request.post("/api/auth/login", { headers: { origin: baseURL!, ...AUTOMATION_HEADERS }, data: { username: "admin", password } });
  expect(login.ok()).toBe(true);
  const adminPage = await admin.newPage();
  await adminPage.goto("/admin");
  await expect(adminPage.getByRole("heading", { name: "Operations" })).toBeVisible();
  await expect(adminPage.getByRole("heading", { name: "AI spend" })).toBeVisible();
  await expect(adminPage.getByRole("link", { name: "Admin" })).toBeVisible();
  await admin.close();

  const user = await browser.newContext({ baseURL, storageState: SHARED_STATE });
  const userPage = await user.newPage();
  expect((await userPage.goto("/admin"))?.status()).toBe(404);
  await expect(userPage.getByRole("link", { name: "Admin" })).toHaveCount(0);
  await user.close();
});
