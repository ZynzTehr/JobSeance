import { expect, test, type Page } from "@playwright/test";
import { TEST_PASSWORD } from "./global-setup";

// Account settings: each test signs up its own account (changing the shared one would sign out
// every other test), changes something on the dashboard, logs in again through the form and
// deletes the account.

const NEW_PASSWORD = "E2e-changed-Passw0rd?";
const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/** The only direct sign-up call in this file; it leaves the page signed in. */
async function signUp(page: Page, baseURL: string) {
  const id = unique();
  const username = `e2e_${id}`;
  const res = await page.request.post("/api/auth/signup", {
    headers: { origin: baseURL },
    data: { username, email: `e2e-${id}@jobseance.example`, password: TEST_PASSWORD },
  });
  expect(res.ok()).toBe(true);
  return { id, username };
}

async function logIn(page: Page, username: string, password: string) {
  await page.context().clearCookies();
  await page.goto("/");
  const login = page.getByRole("form", { name: "Login" });
  await login.getByLabel("Username", { exact: true }).fill(username);
  await login.getByLabel("Password", { exact: true }).fill(password);
  await login.getByRole("button", { name: "Login" }).click();
}

async function deleteAccount(page: Page, baseURL: string) {
  const res = await page.request.delete("/api/v1/me", { headers: { "content-type": "application/json", origin: baseURL }, data: {} });
  expect(res.status()).toBe(204);
}

test("a user changes their password, stays signed in, and logs in with the new one", async ({ page, baseURL }) => {
  const { username } = await signUp(page, baseURL!);
  await page.goto("/dashboard");
  const form = page.getByRole("form", { name: "Password", exact: true });

  await form.getByLabel("Current password").fill("Wrong-passw0rd!");
  await form.getByLabel("New password").fill(NEW_PASSWORD);
  await form.getByRole("button", { name: "Change password" }).click();
  await expect(form.getByRole("status")).toHaveText("Current password is incorrect.");

  await form.getByLabel("Current password").fill(TEST_PASSWORD);
  await form.getByLabel("New password").fill(NEW_PASSWORD);
  await form.getByRole("button", { name: "Change password" }).click();
  await expect(form.getByRole("status")).toHaveText(/Password changed/);
  expect((await page.request.get("/api/v1/me")).status()).toBe(200);

  await logIn(page, username, TEST_PASSWORD);
  await expect(page.getByRole("status")).toHaveText(/invalid username or password/i);
  await logIn(page, username, NEW_PASSWORD);
  await expect(page).toHaveURL(/\/scan$/);
  await deleteAccount(page, baseURL!);
});

test("a user changes their username and logs in with the new one", async ({ page, baseURL }) => {
  const { id, username } = await signUp(page, baseURL!);
  const renamed = `e2n_${id}`;
  await page.goto("/dashboard");
  const form = page.getByRole("form", { name: "Username", exact: true });
  await form.getByLabel("New username").fill(renamed.toUpperCase());
  await form.getByLabel("Current password").fill(TEST_PASSWORD);
  await form.getByRole("button", { name: "Change username" }).click();
  await expect(form.getByRole("status")).toHaveText(`Username changed. Log in as ${renamed} from now on.`);
  await expect(page.locator("aside dl")).toContainText(renamed);

  await logIn(page, username, TEST_PASSWORD);
  await expect(page.getByRole("status")).toHaveText(/invalid username or password/i);
  await logIn(page, renamed, TEST_PASSWORD);
  await expect(page).toHaveURL(/\/scan$/);
  await deleteAccount(page, baseURL!);
});
