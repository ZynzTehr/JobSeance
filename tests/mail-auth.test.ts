import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { addressOf, dmarcPolicy, headerFields, parseAuthResults, parseMailHeaders } from "@/lib/lookups/mail-auth";
import { scoreScam, type MailFacts } from "@/lib/scoring/scam";

const now = new Date("2026-10-27T12:00:00Z");
const headers = (name: string) => readFileSync(path.join(process.cwd(), "fixtures", "headers", name), "utf8");

describe("header parsing", () => {
  it("unfolds continuation lines and stops at the body", () => {
    const f = headerFields("A: one\n two\nB: three\n\nBody: not a header");
    expect(f).toEqual([
      ["a", "one two"],
      ["b", "three"],
    ]);
  });

  it("finds the address in display-name and bare forms", () => {
    expect(addressOf('"Acme HR" <HR@Acme.example>')).toBe("hr@acme.example");
    expect(addressOf("talent@acme.example")).toBe("talent@acme.example");
    expect(addressOf("Undisclosed recipients:;")).toBeNull();
  });

  it("reads Gmail's Authentication-Results: DKIM, SPF and DMARC with its policy", () => {
    const m = parseMailHeaders(headers("gmail-pass.txt"));
    expect(m).toMatchObject({ malformed: false, fromAddress: "talent@acme.example", fromDomain: "acme.example", replyToDomain: "acme.example" });
    expect(m.results).toEqual({
      spf: { result: "pass", domain: "acme.example" },
      dkim: [{ result: "pass", domain: "acme.example" }],
      dmarc: { result: "pass", policy: "reject" },
    });
  });

  it("flags two From lines as malformed instead of picking one", () => {
    expect(parseMailHeaders("From: a@good.example\nFrom: b@evil.example\n").malformed).toBe(true);
  });

  it("ignores results hidden in comments", () => {
    expect(parseAuthResults("mx; spf=fail (dkim=pass header.d=evil.example) smtp.mailfrom=x@acme.example").dkim).toEqual([]);
  });

  it("reads a published DMARC policy from DNS, and treats lookups that fail as unknown", async () => {
    const ok = vi.fn(async () => Response.json({ Status: 0, Answer: [{ type: 16, data: '"v=DMARC1; p=quarantine; rua=mailto:d@acme.example"' }] }));
    expect(await dmarcPolicy("acme.example", { fetchImpl: ok as never })).toBe("quarantine");
    const none = vi.fn(async () => Response.json({ Status: 3 }));
    expect(await dmarcPolicy("acme.example", { fetchImpl: none as never })).toBeNull();
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await dmarcPolicy("acme.example", { fetchImpl: down as never })).toBeNull();
  });
});

const facts = (raw: string, publishedPolicy: MailFacts["publishedPolicy"] = null): MailFacts => {
  const m = parseMailHeaders(raw);
  return { malformed: m.malformed, fromDomain: m.fromDomain, replyToDomain: m.replyToDomain, replyToAts: false, results: m.results, publishedPolicy };
};
const scam = (mail: MailFacts) => scoreScam({ text: null, sender: null, claimed: null, namesEmployer: false, notOnBoard: null, mail, now });

describe("mail authentication rules", () => {
  it("a DMARC pass is a positive fact at 0 points", () => {
    const r = scam(facts(headers("gmail-pass.txt")));
    expect(r.signals).toEqual([expect.objectContaining({ id: "S-AUTH-FAIL", points: 0, status: "found" })]);
    expect(r.signals[0].fact).toContain("passed for acme.example");
  });

  it("a recorded DMARC fail fires S-AUTH-FAIL, and a free-mail Reply-To fires S-REPLY-TO", () => {
    const r = scam(facts(headers("spoofed-fail.txt")));
    expect(r.signals.map((s) => [s.id, s.points])).toEqual([
      ["S-AUTH-FAIL", 20],
      ["S-REPLY-TO", 15],
    ]);
    expect(r.signals[1].fact).toBe("Replies would go to gmail.com, not the sender's domain acme.example");
    for (const s of r.signals) expect(s.cite).toMatch(/^https:\/\//);
  });

  it("unauthenticated mail fires only when the domain publishes reject or quarantine", () => {
    const raw = headers("no-dmarc-record.txt");
    expect(scam(facts(raw, "reject")).signals[0]).toMatchObject({ id: "S-AUTH-FAIL", points: 20 });
    expect(scam(facts(raw, null)).signals[0]).toMatchObject({ id: "S-AUTH-FAIL", points: 0, status: "couldnt_verify" });
  });

  it("headers without results, or with two From lines, are couldn't verify", () => {
    expect(scam(facts("From: a@acme.example\nSubject: x\n")).signals[0]).toMatchObject({ points: 0, status: "couldnt_verify" });
    expect(scam(facts("From: a@x.example\nFrom: b@y.example\n")).signals[0]).toMatchObject({ points: 0, status: "couldnt_verify" });
  });

  it("a Reply-To on a hiring platform is fine", () => {
    const f = { ...facts(headers("gmail-pass.txt")), replyToDomain: "greenhouse-mail.io", replyToAts: true };
    expect(scam(f).signals.find((s) => s.id === "S-REPLY-TO")).toBeUndefined();
  });
});
