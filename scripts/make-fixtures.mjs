// Rebuilds fixtures/*.json from the live job boards: the demo job plus a few
// others, each file under 200 KB. Run: node scripts/make-fixtures.mjs
import { writeFile, mkdir } from "node:fs/promises";

const UA = { "user-agent": "JobSeance/0.1", accept: "application/json" };
const KEEP_OTHERS = 4;
const MAX_BYTES = 200_000;

const boards = [
  {
    file: "greenhouse-discord.json",
    url: "https://boards-api.greenhouse.io/v1/boards/discord/jobs?content=true",
    demo: "8806482002",
    pick: (raw) => raw.jobs,
    idOf: (j) => String(j.id),
    wrap: (jobs) => ({ jobs, meta: { total: jobs.length } }),
  },
  {
    file: "lever-spotify.json",
    url: "https://api.lever.co/v0/postings/spotify?mode=json",
    demo: "223f9722-3579-4ff2-b123-e4cc7b0c1a64",
    pick: (raw) => raw,
    idOf: (j) => j.id,
    wrap: (jobs) => jobs,
  },
  {
    file: "ashby-ramp.json",
    url: "https://api.ashbyhq.com/posting-api/job-board/ramp",
    demo: "34413f8d-26bf-4bbc-8ade-eb309a0e2245",
    pick: (raw) => raw.jobs,
    idOf: (j) => j.id,
    wrap: (jobs, raw) => ({ apiVersion: raw.apiVersion, jobs }),
  },
];

await mkdir("fixtures", { recursive: true });
for (const b of boards) {
  const res = await fetch(b.url, { headers: UA });
  if (!res.ok) throw new Error(`${b.file}: HTTP ${res.status}`);
  const raw = await res.json();
  const all = b.pick(raw);
  const demo = all.find((j) => b.idOf(j) === b.demo);
  if (!demo) throw new Error(`${b.file}: demo job ${b.demo} not on the board`);
  const others = all.filter((j) => b.idOf(j) !== b.demo).slice(0, KEEP_OTHERS);
  const body = JSON.stringify(b.wrap([demo, ...others], raw), null, 2) + "\n";
  if (body.length > MAX_BYTES) throw new Error(`${b.file}: ${body.length} bytes is over the limit`);
  await writeFile(`fixtures/${b.file}`, body);
  console.log(`${b.file}: ${1 + others.length} jobs, ${body.length} bytes`);
}
