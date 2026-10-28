import { expect, test, type APIRequestContext } from "@playwright/test";
import { TEST_PASSWORD } from "./global-setup";

// Sign-up, login, the signed-out redirects and account deletion. Each test that needs an
// account creates its own and deletes it, so tests pass alone and in any order.

const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

async function deleteAccount(request: APIRequestContext, baseURL: string) {
  await request.delete("/api/v1/me", { headers: { "content-type": "application/json", origin: baseURL }, data: {} });
}

test("a new visitor signs up, lands on the scanner signed in, and can log out", async ({ page, baseURL }) => {
  const id = unique();
  await page.goto("/");
  await page.getByRole("form", { name: "Login" }).getByRole("button", { name: "Sign up" }).click();
  const register = page.getByRole("form", { name: "Register" });
  await register.getByLabel("Username").fill(`e2e_${id}`);
  await register.getByLabel("Email").fill(`e2e-${id}@jobseance.example`);
  await register.getByLabel("Password").fill(TEST_PASSWORD);
  await register.getByRole("button", { name: "Register" }).click();

  await expect(page).toHaveURL(/\/scan$/);
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();

  await deleteAccount(page.request, baseURL!);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("form", { name: "Login" })).toBeVisible();
});

test("a returning user logs in; a wrong password shows an error and no session", async ({ page, baseURL }) => {
  const id = unique();
  const signup = await page.request.post("/api/auth/signup", {
    headers: { origin: baseURL! },
    data: { username: `e2e_${id}`, email: `e2e-${id}@jobseance.example`, password: TEST_PASSWORD },
  });
  expect(signup.ok()).toBe(true);
  await page.context().clearCookies();

  await page.goto("/");
  const login = page.getByRole("form", { name: "Login" });
  await login.getByLabel("Username").fill(`e2e_${id}`);
  await login.getByLabel("Password").fill("Wrong-passw0rd!");
  await login.getByRole("button", { name: "Login" }).click();
  await expect(page.getByRole("status")).toHaveText(/invalid username or password/i);
  await expect(page).toHaveURL(/\/$/);

  await login.getByLabel("Password").fill(TEST_PASSWORD);
  await login.getByRole("button", { name: "Login" }).click();
  await expect(page).toHaveURL(/\/scan$/);
  await deleteAccount(page.request, baseURL!);
});

test("signed-out visitors are sent to the login page, and the admin page is a 404", async ({ page }) => {
  await page.goto("/scan");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("form", { name: "Login" })).toBeVisible();

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);

  const admin = await page.goto("/admin");
  expect(admin?.status()).toBe(404);
});

test("a user deletes their account by typing DELETE and is signed out", async ({ page, baseURL }) => {
  const id = unique();
  const signup = await page.request.post("/api/auth/signup", {
    headers: { origin: baseURL! },
    data: { username: `e2e_${id}`, email: `e2e-${id}@jobseance.example`, password: TEST_PASSWORD },
  });
  expect(signup.ok()).toBe(true);

  await page.goto("/dashboard");
  const remove = page.getByRole("button", { name: "Delete my account" });
  await expect(remove).toBeDisabled();
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await remove.click();

  await expect(page).toHaveURL(/\/$/);
  expect((await page.request.get("/api/v1/me")).status()).toBe(401);
});
