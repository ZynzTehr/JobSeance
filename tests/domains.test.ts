import { describe, expect, it, vi } from "vitest";
import {
  findLookalike,
  isAtsSender,
  isDisposable,
  isFreeMail,
  mxLookup,
  normalizeHost,
  parseBootstrap,
  parseMx,
  rdapLookup,
  registrableDomain,
  registrationDate,
} from "@/lib/lookups/domains";

const officials = [
  { domain: "bramblecloud.example", slug: "bramblecloud" },
  { domain: "discord.com", slug: "discord" },
  { domain: "stripe.com", slug: "stripe" },
  { domain: "ramp.com", slug: "ramp" },
  { domain: "databricks.com", slug: "databricks" },
];

describe("registrableDomain", () => {
  it.each([
    ["mail.google.com", "google.com"],
    ["Recruiter@Talent.Discord.com", "discord.com"],
    ["a.b.co.uk", "b.co.uk"],
    ["bramblecloud-careers.example.", "bramblecloud-careers.example"],
  ])("%s → %s", (input, expected) => {
    expect(registrableDomain(input)).toBe(expected);
  });

  it.each(["", "com", "co.uk", "not a domain", "https://x.com/path", "-bad.com"])("rejects %j", (input) => {
    expect(registrableDomain(input)).toBeNull();
  });

  it("normalizes hosts", () => {
    expect(normalizeHost("  US.Greenhouse-Mail.io ")).toBe("us.greenhouse-mail.io");
  });
});

describe("domain lists", () => {
  it("knows free and disposable mail", () => {
    expect(isFreeMail("gmail.com")).toBe(true);
    expect(isFreeMail("outlook.com")).toBe(true);
    expect(isDisposable("mailinator.com")).toBe(true);
    expect(isDisposable("gmail.com")).toBe(false);
  });

  it.each(["greenhouse-mail.io", "lever.co", "ashbyhq.com", "discord.com", "stripe.com", "ramp.com", "google.com"])(
    "%s is not on the free-mail list",
    (d) => {
      expect(isFreeMail(d)).toBe(false);
    },
  );

  it("recognizes ATS senders and their subdomains", () => {
    expect(isAtsSender("hire.lever.co")).toBe(true);
    expect(isAtsSender("us.greenhouse-mail.io")).toBe(true);
    expect(isAtsSender("lever.co")).toBe(false);
    expect(isAtsSender("greenhouse-mail.io.evil.com")).toBe(false);
  });
});

describe("findLookalike", () => {
  it("flags brand + careers on the seeded scam domain", () => {
    expect(findLookalike("bramblecloud-careers.example", officials)).toEqual({
      official: "bramblecloud.example",
      slug: "bramblecloud",
      reason: "brand_suffix",
    });
  });

  it("flags one- and two-edit typos", () => {
    expect(findLookalike("disc0rd.com", officials)).toMatchObject({ official: "discord.com", reason: "typo" });
    expect(findLookalike("databrikcs.com", officials)).toMatchObject({ official: "databricks.com", reason: "typo" });
  });

  it("flags the same brand on another TLD", () => {
    expect(findLookalike("stripe.co", officials)).toMatchObject({ official: "stripe.com", reason: "other_tld" });
  });

  it("flags punycode", () => {
    expect(findLookalike("xn--strpe-9ua.com", officials)).toMatchObject({ reason: "punycode" });
  });

  it("leaves official domains, unrelated domains and short-label near misses alone", () => {
    expect(findLookalike("discord.com", officials)).toBeNull();
    expect(findLookalike("google.com", officials)).toBeNull();
    expect(findLookalike("rap.com", officials)).toBeNull(); // 3-letter label: no typo matching
    expect(findLookalike("stripes2.com", officials)).toBeNull(); // 2 edits on a 6-letter brand
  });
});

describe("RDAP parsing", () => {
  it("reads the IANA bootstrap, preferring https and adding a trailing slash", () => {
    const map = parseBootstrap({
      services: [
        [["com", "net"], ["http://rdap.verisign.com/com/v1/", "https://rdap.verisign.com/com/v1/"]],
        [["org"], ["https://rdap.publicinterestregistry.org/rdap"]],
      ],
    });
    expect(map.get("com")).toBe("https://rdap.verisign.com/com/v1/");
    expect(map.get("org")).toBe("https://rdap.publicinterestregistry.org/rdap/");
  });

  it("finds the registration event", () => {
    const raw = {
      events: [
        { eventAction: "expiration", eventDate: "2028-09-14T04:00:00Z" },
        { eventAction: "registration", eventDate: "1997-09-15T04:00:00Z" },
      ],
    };
    expect(registrationDate(raw)?.toISOString()).toBe("1997-09-15T04:00:00.000Z");
    expect(registrationDate({ events: [] })).toBeNull();
  });

  it("answers reserved TLDs without the network", async () => {
    const fetchImpl = vi.fn();
    await expect(rdapLookup("bramblecloud.example", { fetchImpl })).resolves.toMatchObject({ status: "UNSUPPORTED_TLD" });
    await expect(mxLookup("bramblecloud.example", { fetchImpl })).resolves.toEqual({ hasMx: false, nullMx: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the fallback map for .io and calls an empty 404 not registered", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("data.iana.org")) {
        return Response.json({ services: [[["com"], ["https://rdap.verisign.com/com/v1/"]]] });
      }
      if (u.includes("identitydigital")) {
        return Response.json({ events: [{ eventAction: "registration", eventDate: "2011-07-12T00:00:00Z" }] });
      }
      return new Response("", { status: 404 });
    });
    await expect(rdapLookup("greenhouse.io", { fetchImpl })).resolves.toMatchObject({
      status: "OK",
      source: "unofficial",
      registeredAt: new Date("2011-07-12T00:00:00Z"),
    });
    await expect(rdapLookup("surely-unregistered-xyz.com", { fetchImpl })).resolves.toMatchObject({
      status: "NOT_REGISTERED",
      source: "official",
    });
    await expect(rdapLookup("example.zz", { fetchImpl })).resolves.toMatchObject({ status: "UNSUPPORTED_TLD" });
  });
});

describe("parseMx", () => {
  it("reads MX answers, NXDOMAIN, null MX and failures", () => {
    expect(parseMx({ Status: 0, Answer: [{ type: 15, data: "10 smtp.google.com." }] })).toEqual({ hasMx: true, nullMx: false });
    expect(parseMx({ Status: 0, Answer: [{ type: 15, data: "0 ." }] })).toEqual({ hasMx: false, nullMx: true });
    expect(parseMx({ Status: 0 })).toEqual({ hasMx: false, nullMx: false });
    expect(parseMx({ Status: 3 })).toEqual({ hasMx: false, nullMx: false });
    expect(parseMx({ Status: 2 })).toEqual({ hasMx: null, nullMx: null });
  });
});
