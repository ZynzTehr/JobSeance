import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { MessageExtract } from "@/lib/ai/extract";
import { groundMessage } from "@/lib/ai/extract";
import { replayTransport, type AiTransport } from "@/lib/ai/transport";
import { checkMessageText, type MessageDeps } from "@/lib/checks/message";
import { DEMO_MESSAGE_BRAMBLECLOUD } from "@/lib/demo-examples";
import type { SenderFacts } from "@/lib/scoring/scam";
import type { Company } from "@/app/generated/prisma/client";

const now = new Date("2026-10-27T12:00:00Z");
const acme = { id: "c1", name: "Acme", slug: "acme", officialDomains: ["acme.example"], ats: "NONE", atsBoard: null, isFictional: true } as Company;
const facts = (domain: string, o: Partial<SenderFacts> = {}): SenderFacts => ({
  domain,
  rdapStatus: "OK",
  rdapSource: "RDAP",
  ageDays: 4000,
  hasMx: true,
  nullMx: false,
  freeMail: false,
  disposable: false,
  atsSender: false,
  lookalike: null,
  officialFor: [],
  reporters: 0,
  ...o,
});

const noAi: AiTransport = { extract: async () => ({ ok: false, reason: "off" }), extractMessage: async () => ({ ok: false, reason: "off" }) };

function deps(o: Partial<MessageDeps> = {}): MessageDeps {
  return {
    ai: noAi,
    userId: "u1",
    now,
    findCompany: async (n) => (/acme/i.test(n) ? acme : null),
    sender: vi.fn(async (a: string) => {
      const d = a.slice(a.lastIndexOf("@") + 1);
      return d === "gmail.com" ? facts(d, { freeMail: true }) : facts(d, { officialFor: d === "acme.example" ? ["acme"] : [] });
    }),
    dmarcPolicy: async () => null,
    officials: async () => [{ domain: "acme.example", slug: "acme" }],
    ...o,
  };
}

const headers = (name: string) => readFileSync(path.join(process.cwd(), "fixtures", "headers", name), "utf8");

describe("recruiter message check", () => {
  it("uses the From address in pasted headers when no sender was typed, and says so", async () => {
    const d = deps();
    const r = await checkMessageText({ text: "Hi, we'd like to talk.", headers: headers("gmail-pass.txt") }, d);
    expect(d.sender).toHaveBeenCalledWith("talent@acme.example");
    expect(r.senderDomain).toBe("acme.example");
    expect(r.gathered[0]).toMatchObject({ id: "A-HEADERS", kind: "info" });
    expect(r.scam.signals.find((s) => s.id === "S-AUTH-FAIL")).toMatchObject({ points: 0, status: "found" });
  });

  it("a spoofed company sender with a free-mail Reply-To scores authentication, Reply-To and the reply domain", async () => {
    const r = await checkMessageText({ text: "Congratulations on your offer.", headers: headers("spoofed-fail.txt"), companyClaimed: "Acme" }, deps());
    const fired = r.scam.signals.filter((s) => s.points > 0).map((s) => s.id);
    expect(fired).toEqual(expect.arrayContaining(["S-AUTH-FAIL", "S-REPLY-TO", "S-FREEMAIL"]));
    expect(r.scam.signals.find((s) => s.id === "S-FREEMAIL")?.note).toBe("About the Reply-To domain.");
  });

  it("flags a link that imitates a directory company's official domain", async () => {
    const r = await checkMessageText({ text: "Fill in the form at https://acmme.example/apply today." }, deps());
    expect(r.scam.signals.find((s) => s.id === "S-LOOKALIKE")).toMatchObject({ points: 25 });
    expect(r.scam.signals.find((s) => s.id === "S-LOOKALIKE")?.fact).toBe("A link in the message points to acmme.example, which is a near-spelling of acme.example");
  });

  it("does not flag links to job sites or the company's own domain", async () => {
    const r = await checkMessageText({ text: "See https://www.linkedin.com/jobs/view/1 and https://acme.example/careers" }, deps());
    expect(r.scam.signals.find((s) => s.id === "S-LOOKALIKE")).toBeUndefined();
  });

  it("without the opt-in, no AI call is made", async () => {
    const extractMessage = vi.fn();
    await checkMessageText({ text: "Hello" }, deps({ ai: { ...noAi, extractMessage } }));
    expect(extractMessage).not.toHaveBeenCalled();
  });

  it("the opt-in reading only suggests fields and never changes the score", async () => {
    const plain = await checkMessageText({ text: DEMO_MESSAGE_BRAMBLECLOUD }, deps());
    const read = await checkMessageText({ text: DEMO_MESSAGE_BRAMBLECLOUD, aiRead: true }, deps({ ai: replayTransport({}) }));
    expect(read.scam.score).toBe(plain.scam.score);
    expect(read.reading).toMatchObject({ claimedCompany: "Bramblecloud Software", channels: ["whatsapp"] });
    expect(read.gathered[0]).toMatchObject({ id: "A-READ", kind: "info" });
    expect(read.claimed).toBeNull(); // not counted until the user uses it
  });

  it("keeps only values that literally appear in the message", () => {
    const e: MessageExtract = { claimedCompany: "Globex", contactDomain: "evil.example", channels: ["telegram"], asks: ["none", "urgent_reply"] };
    expect(groundMessage(e, "Write to jane@acme.example for Acme")).toEqual({ claimedCompany: null, contactDomain: null, channels: ["telegram"], asks: ["urgent_reply"] });
    expect(groundMessage({ ...e, claimedCompany: "Acme", contactDomain: "acme.example" }, "Write to jane@acme.example for Acme")).toMatchObject({
      claimedCompany: "Acme",
      contactDomain: "acme.example",
    });
  });

  it("the demo message still shows exactly 8 warning signs through this path", async () => {
    const demo = JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "demo-scam-message.json"), "utf8"));
    const sender = async () =>
      facts("bramblecloud-careers.example", {
        ageDays: 6,
        lookalike: { official: "bramblecloud.example", reason: "brand_suffix" },
        reporters: 3,
      });
    const bramble = { ...acme, name: "Bramblecloud Software", slug: "bramblecloud", officialDomains: ["bramblecloud.example"] } as Company;
    const r = await checkMessageText(demo, deps({ sender, findCompany: async () => bramble, officials: async () => [{ domain: "bramblecloud.example", slug: "bramblecloud" }] }));
    expect(r.scam.signals.filter((s) => s.points > 0)).toHaveLength(8);
    expect(r.scam.score).toBe(100);
  });
});
