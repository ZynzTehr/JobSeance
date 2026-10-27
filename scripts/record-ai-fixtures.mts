// Records Claude's readings of the demo postings into fixtures/ai/ so tests and the
// offline demo (USE_FIXTURES=1) replay real answers. Needs ANTHROPIC_API_KEY.
// Stores the validated answer only, never the input text.
//
//   ANTHROPIC_API_KEY=... npx tsx --tsconfig tsconfig.json scripts/record-ai-fixtures.mts
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { getAnthropic } from "@/lib/ai/client";
import { modelFor } from "@/lib/ai/config";
import { cleanExtract, extractCall } from "@/lib/ai/extract";
import { redactForAi } from "@/lib/ai/sanitize";
import { DEMO_POSTING_BRAMBLECLOUD, DEMO_POSTING_DISCORD } from "@/lib/demo-examples";

if (process.env.USE_FIXTURES === "1") throw new Error("Unset USE_FIXTURES: this script records live answers.");
if (!process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY.");
getAnthropic(); // fail fast on a bad configuration

const demos = [
  { file: "extract-demo-discord.json", text: DEMO_POSTING_DISCORD },
  { file: "extract-demo-bramblecloud.json", text: DEMO_POSTING_BRAMBLECLOUD },
];

const model = modelFor("extract");
for (const demo of demos) {
  const result = await extractCall(redactForAi(demo.text), model);
  if (!result.ok) throw new Error(`${demo.file}: ${result.reason}`);
  const value = cleanExtract(result.value);
  await writeFile(
    path.join(process.cwd(), "fixtures", "ai", demo.file),
    JSON.stringify({ model, recordedAt: new Date().toISOString(), value }, null, 2) + "\n",
  );
  console.log(`${demo.file}: ${value.employerName} / ${value.roleTitle} (${result.inputTokens} in, ${result.outputTokens} out)`);
}
