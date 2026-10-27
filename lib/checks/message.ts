import { z } from "zod";
import { groundMessage, type MessageExtract } from "@/lib/ai/extract";
import { redactForAi, urlsIn } from "@/lib/ai/sanitize";
import type { AiTransport } from "@/lib/ai/transport";
import { AI_REASON_TEXT } from "@/lib/ai/types";
import { findLookalike, registrableDomain, type OfficialDomain } from "@/lib/lookups/domains";
import { classifyHost } from "@/lib/lookups/job-url";
import { MAX_HEADERS, parseMailHeaders, replyToIsAts, type DmarcPolicy } from "@/lib/lookups/mail-auth";
import { SCAM_CITES, SCAM_POINTS } from "@/lib/scoring/config";
import { bandFor, clamp, type Score, type Signal } from "@/lib/scoring/ghost";
import { LOOKALIKE_REASON, scoreScam, type MailFacts, type SenderFacts } from "@/lib/scoring/scam";
import type { Company } from "@/app/generated/prisma/client";

// The Recruiter message check (phase 9b additions). Verifies the channel, never a
// person: sender domain rules as before, plus email authentication and Reply-To from
// pasted headers, look-alike links in the text, and an opt-in Claude reading that
// only prefills fields (nothing it reads counts until the user confirms it).

export const messageExtras = {
  /** Full email headers ("Show original"). Read in memory, never stored. */
  headers: z.string().max(MAX_HEADERS, "Keep the headers under 50,000 characters.").optional(),
  /** Opt-in: send the masked message to Claude to prefill the fields. */
  aiRead: z.boolean().optional(),
};

export type MessageInput = {
  text: string;
  senderEmail?: string;
  companyClaimed?: string;
  headers?: string;
  aiRead?: boolean;
};

export type MessageDeps = {
  ai: AiTransport;
  userId: string;
  now: Date;
  signal?: AbortSignal;
  findCompany(name: string): Promise<Company | null>;
  /** Sender facts for an address or domain, or null if it has no registrable domain. */
  sender(addressOrDomain: string): Promise<SenderFacts | null>;
  dmarcPolicy(domain: string): Promise<DmarcPolicy | null>;
  officials(): Promise<OfficialDomain[]>;
};

export type MessageReading = {
  claimedCompany: string | null;
  /** The full address with this domain as written in the message (for prefilling the field). */
  contactAddress: string | null;
  channels: MessageExtract["channels"];
  asks: MessageExtract["asks"];
};

export type MessageCheck = {
  scam: Score;
  claimed: Company | null;
  senderDomain: string | null;
  gathered: Signal[];
  reading: MessageReading | null;
  ai: { used: boolean; model: string | null; mode: "live" | "replay" | null; suggestedKind: null };
};

const REPLY_RULES = new Set(["S-DISPOSABLE", "S-LOOKALIKE", "S-DOMAIN-NEW", "S-DEAD-DOMAIN", "S-FREEMAIL", "S-REPORTED"]);
const LINK_LOOKALIKE = new Set(["typo", "other_tld", "punycode"]);

const rescore = (signals: Signal[]): Score => {
  const score = clamp(signals.reduce((sum, s) => sum + s.points, 0), 0, 100);
  return { score, band: bandFor(score), signals };
};

export async function checkMessageText(input: MessageInput, deps: MessageDeps): Promise<MessageCheck> {
  const { now } = deps;
  const at = now.toISOString();
  const gathered: Signal[] = [];
  const info = (id: string, fact: string, source: string, status: Signal["status"] = "found") =>
    gathered.push({ id, points: 0, status, fact, source, checkedAt: at, ...(status === "found" ? { kind: "info" as const } : {}) });

  // Headers: parsed in memory only.
  const mail = input.headers?.trim() ? parseMailHeaders(input.headers) : null;
  const fromHeaders = !input.senderEmail && mail && !mail.malformed ? mail.fromAddress : null;
  if (fromHeaders) info("A-HEADERS", "Sender address read from the headers you pasted", "pasted headers");

  const senderAddress = input.senderEmail || fromHeaders;
  const sender = senderAddress ? await deps.sender(senderAddress) : null;
  const claimed = input.companyClaimed ? await deps.findCompany(input.companyClaimed) : null;
  const claimedFacts = claimed && { slug: claimed.slug, name: claimed.name, officialDomains: claimed.officialDomains };

  // Opt-in reading: grounded in the original text, used only to prefill fields.
  let reading: MessageReading | null = null;
  let ai: MessageCheck["ai"] = { used: false, model: null, mode: null, suggestedKind: null };
  if (input.aiRead) {
    const out = await deps.ai.extractMessage(redactForAi(input.text), { userId: deps.userId, signal: deps.signal });
    if (!out.ok) {
      info("A-READ", `Couldn't read the message with AI: ${AI_REASON_TEXT[out.reason]}`, "Claude (Anthropic)", "couldnt_verify");
    } else {
      const g = groundMessage(out.value, input.text);
      const address = g.contactDomain
        ? ([...input.text.matchAll(/[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g)].find((m) => m[1].toLowerCase() === g.contactDomain)?.[0] ?? null)
        : null;
      reading = { claimedCompany: g.claimedCompany, contactAddress: address, channels: g.channels, asks: g.asks };
      ai = { used: true, model: out.model, mode: out.mode, suggestedKind: null };
      info(
        "A-READ",
        "Claude read the message to suggest the sender and company fields (shown above; not stored). Nothing it read counts until you confirm it",
        `Claude (${out.model}${out.mode === "replay" ? ", saved answer" : ""}) reading your pasted text`,
      );
    }
  }

  // Mail authentication facts for the scorer.
  let mailFacts: MailFacts | null = null;
  if (mail) {
    const recorded = mail.results?.dmarc;
    const needPolicy = mail.fromDomain && mail.results && !recorded?.policy && recorded?.result !== "pass" && recorded?.result !== "fail";
    mailFacts = {
      malformed: mail.malformed,
      fromDomain: mail.fromDomain,
      replyToDomain: mail.replyToDomain,
      replyToAts: mail.replyToDomain ? replyToIsAts(mail.replyToDomain) : false,
      results: mail.results,
      publishedPolicy: needPolicy ? await deps.dmarcPolicy(mail.fromDomain!) : null,
    };
  }

  const base = scoreScam({ text: input.text, sender, claimed: claimedFacts, namesEmployer: Boolean(input.companyClaimed), notOnBoard: null, mail: mailFacts, now });
  const signals = [...base.signals];
  const firing = (id: string) => signals.some((s) => s.id === id && s.points > 0);

  // The domain replies would go to gets the same domain checks as a sender.
  if (mailFacts?.replyToDomain && mailFacts.fromDomain && mailFacts.replyToDomain !== mailFacts.fromDomain && !mailFacts.replyToAts) {
    const reply = await deps.sender(mailFacts.replyToDomain);
    if (reply) {
      const extra = scoreScam({ text: null, sender: reply, claimed: claimedFacts, namesEmployer: Boolean(input.companyClaimed), notOnBoard: null, now });
      for (const s of extra.signals) if (REPLY_RULES.has(s.id) && s.points > 0 && !firing(s.id)) signals.push({ ...s, note: "About the Reply-To domain." });
    }
  }

  // A link that imitates a directory company's official domain (pure check, no network).
  if (!firing("S-LOOKALIKE")) {
    const officials = await deps.officials();
    for (const url of urlsIn(input.text)) {
      let host: string;
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch {
        continue;
      }
      const kind = classifyHost(host).kind;
      const domain = registrableDomain(host);
      if (!domain || kind === "job_site" || kind === "ats" || domain === sender?.domain) continue;
      const look = findLookalike(domain, officials);
      if (look && LINK_LOOKALIKE.has(look.reason)) {
        signals.push({
          id: "S-LOOKALIKE",
          points: SCAM_POINTS["S-LOOKALIKE"],
          status: "found",
          fact: `A link in the message points to ${domain}, which ${LOOKALIKE_REASON[look.reason]}${look.official ? ` ${look.official}` : ""}`,
          source: "JobSeance lookalike check",
          cite: SCAM_CITES["S-LOOKALIKE"],
          checkedAt: at,
        });
        break;
      }
    }
  }

  return { scam: rescore(signals), claimed, senderDomain: sender?.domain ?? null, gathered, reading, ai };
}
