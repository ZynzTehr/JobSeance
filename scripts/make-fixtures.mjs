// Rebuilds fixtures/*.json from the live job boards: the demo job plus a few
// others, each file under 200 KB. Run: node scripts/make-fixtures.mjs
// Only the phase 10 systems (keeps the demo boards as they are): node scripts/make-fixtures.mjs --adapters
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
for (const b of process.argv.includes("--adapters") ? [] : boards) {
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

// ---- Phase 10 adapters: a few jobs each, raw shapes the normalizers in lib/lookups/adapters.ts read.
// Workday and SmartRecruiters fixtures carry detail responses in a `details` map keyed by path or id.
const GZ = { ...UA, "accept-encoding": "gzip" }; // amazon.jobs truncates bodies sent with Node's default encodings
const get = async (url) => {
  const res = await fetch(url, { headers: GZ, redirect: "error" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
};
const post = async (url, body) => {
  const res = await fetch(url, { method: "POST", headers: { ...GZ, "content-type": "application/json" }, body: JSON.stringify(body), redirect: "error" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
};
const save = async (file, data, count) => {
  const body = JSON.stringify(data, null, 2) + "\n";
  if (body.length > MAX_BYTES) throw new Error(`${file}: ${body.length} bytes is over the limit`);
  await writeFile(`fixtures/${file}`, body);
  console.log(`${file}: ${count} jobs, ${body.length} bytes`);
};
const KEEP = 1 + KEEP_OTHERS;
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

{
  const base = "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite";
  const list = await post(`${base}/jobs`, { appliedFacets: {}, limit: KEEP, offset: 0, searchText: "" });
  const jobPostings = list.jobPostings.slice(0, KEEP);
  const details = {};
  for (const j of jobPostings) {
    const info = (await get(`${base}${j.externalPath}`)).jobPostingInfo ?? {};
    details[j.externalPath] = { jobPostingInfo: pick(info, ["title", "jobDescription", "location", "startDate", "jobReqId", "externalUrl"]) };
  }
  await save("workday-nvidia--nvidiaexternalcareersite.json", { total: list.total, jobPostings, details }, jobPostings.length);
}
{
  const base = "https://api.smartrecruiters.com/v1/companies/Ubisoft2/postings";
  const list = await get(`${base}?limit=${KEEP}&offset=0`);
  // Only the fields the normalizer reads: the detail's "creator" names a real person and stays out.
  const SR_KEYS = ["id", "name", "releasedDate", "location", "refNumber"];
  const content = list.content.slice(0, KEEP).map((p) => pick(p, SR_KEYS));
  const details = {};
  for (const p of content) details[p.id] = pick(await get(`${base}/${p.id}`), [...SR_KEYS, "postingUrl", "jobAd"]);
  await save("smartrecruiters-ubisoft2.json", { totalFound: list.totalFound, content, details }, content.length);
}
{
  const raw = await get("https://apply.workable.com/api/v1/widget/accounts/huggingface?details=true");
  const jobs = raw.jobs
    .slice(0, KEEP)
    .map((j) => pick(j, ["shortcode", "title", "city", "state", "country", "url", "published_on", "description"]));
  await save("workable-huggingface.json", { jobs }, jobs.length);
}
{
  const raw = await get("https://bunq.recruitee.com/api/offers/");
  const offers = raw.offers
    .slice(0, KEEP)
    .map((o) => pick(o, ["id", "slug", "title", "location", "careers_url", "published_at", "status", "description", "requirements"]));
  await save("recruitee-bunq.json", { offers }, offers.length);
}
{
  const raw = await get(`https://www.amazon.jobs/en/search.json?base_query=&result_limit=${KEEP}&offset=0`);
  const jobs = raw.jobs
    .slice(0, KEEP)
    .map((j) => pick(j, ["id_icims", "title", "job_path", "posted_date", "normalized_location", "location", "description", "basic_qualifications", "preferred_qualifications"]));
  await save("amazon-amazon.json", { hits: raw.hits, jobs }, jobs.length);
}
