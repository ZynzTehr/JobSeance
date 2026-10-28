// Runs the daily board sweep once from this machine against DATABASE_URL (the dev branch in
// .env; see AGENTS.md to point it at production). Prints counts only.
//
//   npx tsx --tsconfig tsconfig.json scripts/sweep.mts
import "dotenv/config";
import { getDb } from "@/lib/db";
import { runSweep } from "@/lib/lookups/sweep";

if (process.env.USE_FIXTURES === "1") throw new Error("Unset USE_FIXTURES: the sweep reads live boards.");
const counts = await runSweep(getDb());
console.log(`sweep: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ")}`);
process.exit(0);
