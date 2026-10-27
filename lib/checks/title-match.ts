// Role-title matching for pasted postings. Job sites decorate titles ("Senior Data
// Engineer - Remote (US) | Acme"), so both sides are reduced to the role itself first.
// Only an exact match after that reduction is strong enough to count points when the
// title was read by AI; anything weaker is shown as the closest title, not counted.

const SUFFIX_SPLIT = /\s+(?:[-–—|·•]|@|\bat\b)\s+/i;
const PARENS = /\([^)]*\)|\[[^\]]*\]/g;
const STOP = new Set(["the", "a", "an", "and", "of", "for", "to", "in", "on", "with", "remote", "hybrid", "onsite", "on-site", "us", "usa"]);

/** "Senior Data Engineer - Remote (US) | Acme" → "senior data engineer". */
export function roleKey(title: string): string {
  const head = title.replace(PARENS, " ").split(SUFFIX_SPLIT)[0] ?? "";
  return head
    .toLowerCase()
    .replace(/\bsr\b\.?/g, "senior")
    .replace(/\bjr\b\.?/g, "junior")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const tokens = (s: string) => new Set(roleKey(s).split(" ").filter((t) => t && !STOP.has(t)));

export function jaccard(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared += 1;
  return shared / (x.size + y.size - shared);
}

export type RoleMatch<T> = { exact: T | null; closest: { item: T; similarity: number } | null };

/** Exact role match (after decoration is stripped), else the closest title with similarity >= 0.5. */
export function matchRoleOnBoard<T extends { title: string }>(items: T[], role: string): RoleMatch<T> {
  const want = roleKey(role);
  if (!want) return { exact: null, closest: null };
  const exact = items.find((i) => roleKey(i.title) === want) ?? null;
  if (exact) return { exact, closest: { item: exact, similarity: 1 } };
  let best: { item: T; similarity: number } | null = null;
  for (const item of items) {
    const similarity = jaccard(item.title, role);
    if (similarity >= 0.5 && (!best || similarity > best.similarity)) best = { item, similarity };
  }
  return { exact: null, closest: best };
}
