import { expect, test, type Page } from "@playwright/test";
import { SHARED_STATE } from "./global-setup";

// The four kinds of check, run as a signed-in user. Job boards and Claude replay recorded
// answers (USE_FIXTURES=1), so results are the same on every run.

test.use({ storageState: SHARED_STATE });

/** The band label shown next to a risk heading ("Ghost-job risk" or "Scam risk"). */
const band = (page: Page, title: string) =>
  page.getByRole("region", { name: "Risk bands" }).locator("div").filter({ has: page.getByRole("heading", { name: title, exact: true }) }).last();

async function runDemo(page: Page, tab: string) {
  await page.goto("/scan");
  await page.getByRole("tab", { name: tab }).click();
  await page.getByRole("button", { name: "Try the demo example" }).click();
  await page.getByRole("button", { name: "Check it" }).click();
  await expect(page.getByRole("region", { name: "Risk bands" })).toBeVisible();
}

test("a user checks a Discord job link and sees both risk bands and the evidence", async ({ page }) => {
  await runDemo(page, "Job link");
  await expect(page.getByRole("heading", { name: "Commercial Policy Lead" })).toBeVisible();
  await expect(band(page, "Ghost-job risk")).toContainText(/Low|Caution|High/);
  await expect(band(page, "Scam risk")).toContainText("Low");
  await expect(page.getByText("Live on Discord's Greenhouse board")).toBeVisible();
});

test("a user pastes the demo scam message and sees High scam risk with 8 warning signs", async ({ page }) => {
  await runDemo(page, "Recruiter message");
  await expect(band(page, "Scam risk")).toContainText("High");
  await expect(page.getByText("This message shows 8 scam warning signs.")).toBeVisible();
});

test("company and role finds a live Discord role; an unknown company says its board wasn't found", async ({ page }) => {
  await page.goto("/scan");
  await page.getByRole("tab", { name: "Company + role" }).click();
  const company = page.getByRole("textbox", { name: "Company", exact: true });
  const role = page.getByRole("textbox", { name: "Role title", exact: true });
  await company.fill("Discord");
  await role.fill("Commercial Policy Lead");
  await page.getByRole("button", { name: "Check it" }).click();
  await expect(page.getByText("Live on Discord's Greenhouse board")).toBeVisible();

  await company.fill("Zzyzx Nonexistent Holdings");
  await role.fill("Analyst");
  await page.getByRole("button", { name: "Check it" }).click();
  await expect(page.getByText(/couldn't find its job board/)).toBeVisible();
});

test("a pasted posting shows what Claude read, and confirming it checks again with those values", async ({ page }) => {
  await runDemo(page, "Pasted posting");
  const reading = page.getByRole("region", { name: "What Claude read from your text" });
  await expect(reading).toContainText("Discord");
  await expect(reading).toContainText("Commercial Policy Lead");

  await page.getByRole("button", { name: /That.s right, check it with these/ }).click();
  await expect(page.getByText("Company and role as you entered them")).toBeVisible();
  await expect(page.getByText("Live on Discord's Greenhouse board")).toBeVisible();
});

test("a saved check appears on the dashboard and can be unsaved", async ({ page }) => {
  await runDemo(page, "Job link");
  await page.getByRole("button", { name: "Save this check" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();

  await page.goto("/dashboard");
  const saved = page.getByRole("region", { name: "Saved checks" });
  await expect(saved.getByRole("link", { name: "Commercial Policy Lead" }).first()).toBeVisible();
  await saved.getByRole("button", { name: "Unsave Commercial Policy Lead" }).first().click();
  // Only this test saves checks for the shared account, so the list ends up empty.
  await expect(saved.getByRole("button", { name: "Unsave Commercial Policy Lead" })).toHaveCount(0);
});

test("a user reports the scam sender and sees the report on their dashboard", async ({ page }) => {
  await runDemo(page, "Recruiter message");
  await page.getByRole("button", { name: "Report this sender" }).click();
  await expect(page.getByRole("button", { name: "Reported" })).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByRole("region", { name: "My scam reports" })).toContainText("Sender domain bramblecloud-careers.example");
});
