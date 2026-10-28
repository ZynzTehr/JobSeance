import { afterEach, describe, expect, it, vi } from "vitest";

// checkCompanyRole reads community reports from the database; a stand-in answers with none.
vi.mock("@/lib/db", () => ({ getDb: () => ({ outcomeReport: { findMany: async () => [] }, posting: { findMany: async () => [] } }) }));

const { checkCompanyRole } = await import("@/lib/checks/run");

const NVIDIA = {
  id: "c-nvidia",
  name: "NVIDIA",
  slug: "nvidia",
  officialDomains: ["nvidia.com"],
  ats: "WORKDAY" as const,
  atsBoard: "nvidia/NVIDIAExternalCareerSite",
  atsHost: "nvidia.wd5.myworkdayjobs.com",
  careersHosts: [],
  isFictional: false,
};
const NOW = new Date("2026-10-28T12:00:00Z");

describe("company + role on a system we can only search", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("a role missing from the search is couldn't verify: 0 ghost points and no scam point", async () => {
    vi.stubEnv("USE_FIXTURES", "1"); // the recorded NVIDIA board, no network
    const r = await checkCompanyRole(NVIDIA, "Chief Unicorn Wrangler", NOW);
    expect(r.ghost.signals.find((s) => s.id === "G-BOARD")).toMatchObject({ points: 0, status: "couldnt_verify", fact: expect.stringMatching(/turned up in a search/) });
    expect(r.scam.signals.find((s) => s.id === "S-NOT-ON-BOARD")).toBeUndefined();
    expect(r.ghost.score).toBeNull();
  });
});
