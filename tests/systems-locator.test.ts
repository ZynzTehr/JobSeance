import { describe, expect, it, vi } from "vitest";
import type { SearchHit } from "@/lib/ai/locate";
import type { AiTransport } from "@/lib/ai/transport";

// The locator's other-systems step against a stubbed board cache: a fresh board search's results
// are reused (no second search); a cached "no board" answer gets one narrow search, remembered.

const cached = new Map<string, unknown>();
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    boardDiscovery: {
      findUnique: async ({ where }: { where: { key: string } }) => cached.get(where.key) ?? null,
      upsert: async () => undefined,
    },
  }),
}));

const { locator } = await import("@/lib/checks/run");

const NOW = new Date("2026-10-28T12:00:00Z");
const ICIMS: SearchHit[] = [{ url: "https://careers-reyesholdings.icims.com/jobs/1/software-developer/job", title: "Software Developer in Chicago, IL | Careers at Reyes Holdings", pageAge: null }];
const off = async () => ({ ok: false as const, reason: "off" as const });

function transport(o: Partial<AiTransport> = {}): AiTransport {
  return { extract: off, extractMessage: off, guessBoards: async () => ({ ok: true, value: [], mode: "live", model: "claude-haiku-5-5" }), ...o };
}

describe("locator: hiring systems we can't read", () => {
  it("reuses the board search's results without a second search", async () => {
    vi.stubEnv("USE_FIXTURES", "1"); // no live board probes
    const searchSystems = vi.fn();
    const ai = transport({ searchBoards: async () => ({ ok: true, value: { boards: [], others: ICIMS }, mode: "live", model: "claude-sonnet-5-5" }), searchSystems });
    const out = await locator("sys-user-1", NOW, ai, Date.now())("Reyes Holdings", "Software Developer", true);
    expect(searchSystems).not.toHaveBeenCalled();
    expect(out.located).toBe(true);
    expect(out.rows.map((r) => [r.id, r.status])).toEqual([
      ["A-LOCATE", "couldnt_verify"],
      ["A-SYSTEM", "found"],
      ["A-LISTING", "found"],
    ]);
    vi.unstubAllEnvs();
  });

  it("a cached 'no board' answer gets one narrow search, remembered for the next check", async () => {
    cached.set("acme-foods", { key: "acme-foods", employerName: "", status: "NOT_FOUND", ats: null, board: null, host: null, declaredName: null, method: "search", expiresAt: new Date("2026-11-01") });
    const hits = [{ url: "https://acmefoods.taleo.net/careersection/1/jobdetail.ftl?job=9", title: "Driver - Acme Foods", pageAge: null }];
    const searchSystems = vi.fn(async () => ({ ok: true as const, value: hits, mode: "live" as const, model: "claude-sonnet-5-5" }));
    const searchBoards = vi.fn();
    const ai = transport({ searchBoards, searchSystems });
    const first = await locator("sys-user-2", NOW, ai, Date.now())("Acme Foods", "Driver", true);
    const second = await locator("sys-user-2", NOW, ai, Date.now())("Acme Foods", "Driver", true);
    expect(searchBoards).not.toHaveBeenCalled();
    expect(searchSystems).toHaveBeenCalledTimes(1);
    expect(searchSystems).toHaveBeenCalledWith("Acme Foods", "Driver", expect.anything());
    expect(first.ai).toMatchObject({ used: true, model: "claude-sonnet-5-5" });
    for (const out of [first, second]) {
      expect(out.located).toBe(true);
      expect(out.rows.find((r) => r.id === "A-SYSTEM")?.fact).toMatch(/appear on Taleo \(account "acmefoods"\)/);
    }
  });

  it("a board found under the company's name that lists nothing still gets the hiring-system search", async () => {
    // Like Reyes Holdings: an empty Workable account under its name, its real jobs on iCIMS.
    cached.set("reyes-holdings", { key: "reyes-holdings", employerName: "Reyes Holdings", status: "FOUND", ats: "WORKABLE", board: "reyes-holdings", host: null, declaredName: "Reyes Holdings", method: "probe", expiresAt: new Date("2026-11-20") });
    const searchSystems = vi.fn(async () => ({ ok: true as const, value: ICIMS, mode: "live" as const, model: "claude-sonnet-5-5" }));
    const out = await locator("sys-user-4", NOW, transport({ searchSystems }), Date.now())("Reyes Holdings", null, true);
    expect(searchSystems).toHaveBeenCalledTimes(1);
    expect(out.rows.map((r) => [r.id, r.status])).toEqual([
      ["A-LOCATE", "found"],
      ["A-SYSTEM", "found"],
    ]);
  });

  it("no extra search when the board search failed or the check is out of time", async () => {
    vi.stubEnv("USE_FIXTURES", "1");
    const searchSystems = vi.fn();
    const failed = transport({ searchBoards: async () => ({ ok: false, reason: "timeout" }), searchSystems });
    const out = await locator("sys-user-3", NOW, failed, Date.now())("Bramble Logistics", null, true);
    expect(out).toMatchObject({ located: false, aiFailure: "timeout" });
    cached.set("bramble-farms", { key: "bramble-farms", employerName: "", status: "NOT_FOUND", ats: null, board: null, host: null, declaredName: null, method: "search", expiresAt: new Date("2026-11-01") });
    await locator("sys-user-3", NOW, transport({ searchSystems }), Date.now() - 60_000)("Bramble Farms", null, true);
    expect(searchSystems).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
