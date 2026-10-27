import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Recorded AI answers for tests and the offline demo (USE_FIXTURES=1). A fixture holds
// the validated answer only, never the input text. Keyed by prompt version + model +
// normalized input, with a manifest fallback so a demo text survives small edits.

export const normalizeForKey = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

export function fixtureKey(step: string, promptVersion: string, model: string, input: string): string {
  const hash = createHash("sha256").update(`${promptVersion}\n${model}\n${normalizeForKey(input)}`).digest("hex");
  return `${step}-${hash.slice(0, 16)}`;
}

type Manifest = { entries: { step: string; prefix: string; file: string }[] };
const SAFE_FILE = /^[a-z0-9-]{1,80}\.json$/;

const dir = () => path.join(process.cwd(), "fixtures", "ai");

async function readJson(file: string): Promise<unknown> {
  if (!SAFE_FILE.test(file)) return null;
  try {
    return JSON.parse(await readFile(path.join(dir(), file), "utf8"));
  } catch {
    return null;
  }
}

/** The recorded `{ value, model }` for this input, or null. */
export async function readFixture(step: string, key: string, input: string): Promise<{ value: unknown; model: string } | null> {
  const exact = (await readJson(`${key}.json`)) as { value?: unknown; model?: string } | null;
  if (exact?.value !== undefined) return { value: exact.value, model: exact.model ?? "recorded" };

  const manifest = (await readJson("manifest.json")) as Manifest | null;
  const prefix = normalizeForKey(input).slice(0, 200);
  const entry = manifest?.entries.find((e) => e.step === step && prefix.startsWith(normalizeForKey(e.prefix).slice(0, 200)));
  if (!entry) return null;
  const aliased = (await readJson(entry.file)) as { value?: unknown; model?: string } | null;
  return aliased?.value !== undefined ? { value: aliased.value, model: aliased.model ?? "recorded" } : null;
}
