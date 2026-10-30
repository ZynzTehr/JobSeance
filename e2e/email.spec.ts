import { expect, test } from "@playwright/test";
import { AUTOMATION_HEADERS } from "./global-setup";

// Email is off by default (lib/email.ts emailEnabled); playwright.config.ts keeps it off here.
// With it off, nothing links to the email pages, and the pages and their API routes are 404s.

test("with email off, the login form has no Forgot password link and the email pages are 404s", async ({ page, baseURL }) => {
  await page.goto("/login");
  const login = page.getByRole("form", { name: "Login" });
  await expect(login.getByRole("button", { name: "Login" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Forgot password?" })).toHaveCount(0);

  for (const path of ["/forgot-password", "/reset-password?token=abc", "/verify-email?token=abc"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }

  const headers = { origin: baseURL!, ...AUTOMATION_HEADERS };
  const posts: [string, Record<string, string>][] = [
    ["/api/auth/forgot-password", { email: "someone@jobseance.example" }],
    ["/api/auth/reset-password", { token: "abc", newPassword: "Some-passw0rd!" }],
    ["/api/auth/verify-email", { token: "abc" }],
  ];
  for (const [path, data] of posts) {
    const response = await page.request.post(path, { headers, data });
    expect(response.status(), path).toBe(404);
  }
});
