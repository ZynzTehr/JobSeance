import { expect, test } from "@playwright/test";
import { AUTOMATION_HEADERS, TEST_PASSWORD } from "./global-setup";

// The form bot guard on sign-up (lib/bot-guard.ts): decoy field, signed render-time token
// with a two-second minimum, and the automation key. BotID only runs on Vercel, so not here.

const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
const account = (id: string) => ({ username: `e2e_${id}`, email: `e2e-${id}@jobseance.example`, password: TEST_PASSWORD });

test("sign-up without a form token is refused, and a filled decoy field is refused even with the key", async ({ request, baseURL }) => {
  const id = unique();
  const bare = await request.post("/api/auth/signup", { headers: { origin: baseURL! }, data: account(id) });
  expect(bare.status()).toBe(400);
  expect((await bare.json()).error.code).toBe("form_expired");

  const decoy = await request.post("/api/auth/signup", {
    headers: { origin: baseURL!, ...AUTOMATION_HEADERS },
    data: { ...account(id), fax: "555-0100" },
  });
  expect(decoy.status()).toBe(400);
  expect((await decoy.json()).error.code).toBe("form_rejected");
});

test("the page's form token is refused straight away and accepted after two seconds", async ({ page, baseURL }) => {
  const html = await (await page.request.get("/signup")).text();
  // The token reaches the client inside the server-rendered props.
  const formToken = html.match(/formToken\\?":\\?"(\d{13}\.[\w-]+)/)?.[1];
  expect(formToken).toBeTruthy();

  const id = unique();
  const fast = await page.request.post("/api/auth/signup", { headers: { origin: baseURL! }, data: { ...account(id), formToken } });
  expect(fast.status()).toBe(400);
  expect((await fast.json()).error.code).toBe("form_too_fast");

  await page.waitForTimeout(2_100);
  const ok = await page.request.post("/api/auth/signup", { headers: { origin: baseURL! }, data: { ...account(id), fax: "", formToken } });
  expect(ok.status()).toBe(201);
  await page.request.delete("/api/v1/me", { headers: { "content-type": "application/json", origin: baseURL! }, data: {} });
});

