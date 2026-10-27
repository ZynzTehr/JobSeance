import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every variable from the spec's environment table.
const SPEC_VARS = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "JWT_SECRET",
  "OAUTH_COOKIE_SECRET",
  "APP_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_CALLBACK_URL",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_CALLBACK_URL",
  "CRON_SECRET",
  "DEMO_USER_EMAIL",
  "DEMO_USER_PASSWORD",
  "ADMIN_USER_EMAIL",
  "ADMIN_USER_PASSWORD",
  "USE_FIXTURES",
  "ANTHROPIC_API_KEY",
  "AI_MODE",
  "AI_MODEL",
  "AI_MODEL_LOCATE",
  "AI_DAILY_USD",
];

function parseEnvExample(): Map<string, string> {
  const text = readFileSync(join(process.cwd(), ".env.example"), "utf8");
  const entries = new Map<string, string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    entries.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  return entries;
}

describe(".env.example", () => {
  it("lists exactly the spec's variables", () => {
    expect([...parseEnvExample().keys()].sort()).toEqual([...SPEC_VARS].sort());
  });

  it("contains no values", () => {
    for (const [key, value] of parseEnvExample()) {
      expect(value, key).toBe("");
    }
  });
});
