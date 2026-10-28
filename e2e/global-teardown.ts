import { rm } from "node:fs/promises";
import { request, type FullConfig } from "@playwright/test";
import { SHARED_STATE } from "./global-setup";

/** Deletes the shared account; its reports and scam reports go with it, its checks are unlinked. */
export default async function globalTeardown(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!;
  const api = await request.newContext({ baseURL, storageState: SHARED_STATE, extraHTTPHeaders: { origin: baseURL } });
  await api.delete("/api/v1/me", { headers: { "content-type": "application/json" }, data: {} });
  await api.dispose();
  await rm(SHARED_STATE, { force: true });
}
