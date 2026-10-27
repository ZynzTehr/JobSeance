// Runs before every test file. Tests never call the network for AI: a developer's
// exported ANTHROPIC_API_KEY must not switch the live path on during `npm test`.
process.env.AI_MODE = process.env.AI_MODE ?? "off";
delete process.env.ANTHROPIC_API_KEY;

const realFetch = globalThis.fetch;
const AI_HOSTS = /(^|\.)(anthropic\.com|typesafe\.ai)$/i;

globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (AI_HOSTS.test(new URL(url).hostname)) return Promise.reject(new Error("tests must not call AI APIs"));
  return realFetch(input, init);
}) as typeof fetch;
