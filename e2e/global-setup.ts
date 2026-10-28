import { mkdir } from "node:fs/promises";
import { request, type FullConfig } from "@playwright/test";

/** Signed-in state for the tests that only need "a signed-in user". Deleted again in global-teardown. */
export const SHARED_STATE = "e2e/.auth/user.json";
export const TEST_PASSWORD = "E2e-test-Passw0rd!";

/** One throwaway account per run: sign-up allows 30 accounts an hour from one address. */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!;
  const id = Date.now().toString(36);
  const api = await request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL } });
  const res = await api.post("/api/auth/signup", { data: { username: `e2e_${id}`, email: `e2e-${id}@jobseance.example`, password: TEST_PASSWORD } });
  if (!res.ok()) throw new Error(`Shared test account sign-up failed: ${res.status()} ${await res.text()}`);
  await mkdir("e2e/.auth", { recursive: true });
  await api.storageState({ path: SHARED_STATE });
  await api.dispose();
}
