// Runs before every test file. Tests never call the network for AI or email: a developer's
// exported ANTHROPIC_API_KEY or Postmark settings must not switch a live path on during `npm test`.
process.env.AI_MODE = process.env.AI_MODE ?? "off";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.EMAIL_ENABLED;
delete process.env.POSTMARK_SERVER_TOKEN;
delete process.env.EMAIL_FROM;

const realFetch = globalThis.fetch;
const BLOCKED_HOSTS = /(^|\.)(anthropic\.com|typesafe\.ai|postmarkapp\.com)$/i;

globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (BLOCKED_HOSTS.test(new URL(url).hostname)) return Promise.reject(new Error("tests must not call AI or email APIs"));
  return realFetch(input, init);
}) as typeof fetch;
