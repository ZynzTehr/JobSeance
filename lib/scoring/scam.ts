import {
  DOMAIN_NEW,
  REPORTED,
  RUN_CODE_NOTE,
  SCAM_CITES,
  ANTI_FRAUD_NOTICE,
  SCAM_PHRASES,
  SCAM_POINTS,
  type ScamRuleId,
} from "@/lib/scoring/config";
import { bandFor, clamp, matchPhrases, quoteMatches, type Score, type Signal } from "@/lib/scoring/ghost";

/** Facts read from pasted email headers (lib/lookups/mail-auth.ts), gathered by the caller. */
export type MailFacts = {
  malformed: boolean;
  fromDomain: string | null;
  replyToDomain: string | null;
  replyToAts: boolean;
  results: {
    spf: { result: string; domain: string | null } | null;
    dkim: { result: string; domain: string | null }[];
    dmarc: { result: string; policy: string | null } | null;
  } | null;
  /** The From domain's published DMARC policy (from DNS), when the headers didn't record one. */
  publishedPolicy: "reject" | "quarantine" | "none" | null;
};

/** Facts about the sender's registrable domain, gathered by the caller. */
export type SenderFacts = {
  domain: string; // registrable domain only: never the part before the @
  rdapStatus: "OK" | "NOT_REGISTERED" | "UNSUPPORTED_TLD" | "ERROR";
  rdapSource: string; // "RDAP", "RDAP (unofficial)", "RDAP (cached)"
  ageDays: number | null;
  hasMx: boolean | null;
  nullMx: boolean | null;
  freeMail: boolean;
  disposable: boolean;
  atsSender: boolean;
  lookalike: { official: string | null; reason: string } | null;
  officialFor: string[]; // company slugs whose official domains include this one
  reporters: number; // distinct users who reported this sender domain
};

export type ScamInput = {
  text: string | null; // pasted message or posting description
  sender: SenderFacts | null;
  /** The company the message claims to be from, if we could resolve it. */
  claimed: { slug: string; name: string; officialDomains: string[] } | null;
  /** The message named an employer, resolved or not (for S-FREEMAIL). */
  namesEmployer: boolean;
  /** Same lookup as G-BOARD, for URL and company + role checks. */
  notOnBoard: { fact: string; source: string } | null;
  /** Only when the user pasted the email's headers. */
  mail?: MailFacts | null;
  now: Date;
};

export const LOOKALIKE_REASON: Record<string, string> = {
  typo: "is a near-spelling of",
  brand_suffix: "adds a word to",
  other_tld: "uses another ending than",
  punycode: "uses look-alike (punycode) characters",
};

export function scoreScam(input: ScamInput): Score {
  const at = input.now.toISOString();
  const signals: Signal[] = [];
  const fire = (id: ScamRuleId, fact: string, source: string, points: number = SCAM_POINTS[id], note?: string) =>
    signals.push({ id, points, status: "found", fact, source, checkedAt: at, ...(SCAM_CITES[id] ? { cite: SCAM_CITES[id] } : {}), ...(note ? { note } : {}) });
  const info = (id: string, fact: string, source: string, status: Signal["status"] = "found") =>
    signals.push({ id, points: 0, status, fact, source, checkedAt: at });

  // Phrase rules, in table order.
  for (const [id, phrases] of Object.entries(SCAM_PHRASES) as [ScamRuleId, NonNullable<(typeof SCAM_PHRASES)[ScamRuleId]>][]) {
    const hits = matchPhrases(input.text, phrases, ANTI_FRAUD_NOTICE);
    if (hits.length) fire(id, quoteMatches(hits), "rules", SCAM_POINTS[id], id === "S-RUN-CODE" ? RUN_CODE_NOTE : undefined);
  }

  if (input.notOnBoard) fire("S-NOT-ON-BOARD", input.notOnBoard.fact, input.notOnBoard.source);

  const s = input.sender;
  if (s) {
    const official = input.claimed?.officialDomains.includes(s.domain) ?? false;
    const anyOfficial = s.officialFor.length > 0;

    if (s.disposable) fire("S-DISPOSABLE", `${s.domain} is a disposable email service`, "disposable-email-domains list");

    if (s.lookalike && !anyOfficial) {
      const why = LOOKALIKE_REASON[s.lookalike.reason] ?? "resembles";
      fire("S-LOOKALIKE", s.lookalike.official ? `${s.domain} ${why} ${s.lookalike.official}` : `${s.domain} ${why}`, "JobSeance lookalike check");
    }

    // S-DOMAIN-NEW: only from a real registration date.
    if (s.rdapStatus === "OK" && s.ageDays !== null) {
      if (s.ageDays < DOMAIN_NEW.newDays) {
        fire("S-DOMAIN-NEW", `${s.domain} registered ${s.ageDays} days ago`, s.rdapSource);
      } else if (s.ageDays < DOMAIN_NEW.youngDays) {
        fire("S-DOMAIN-NEW", `${s.domain} registered ${s.ageDays} days ago`, s.rdapSource, DOMAIN_NEW.youngPoints);
      } else {
        info("S-DOMAIN-NEW", `${s.domain} registered ${Math.floor(s.ageDays / 365)} years ago`, s.rdapSource);
      }
    } else if (s.rdapStatus === "ERROR" || s.rdapStatus === "UNSUPPORTED_TLD") {
      info("S-DOMAIN-NEW", `Couldn't verify when ${s.domain} was registered`, s.rdapSource, "couldnt_verify");
    }

    if (s.rdapStatus === "NOT_REGISTERED" || s.nullMx) {
      fire("S-DEAD-DOMAIN", s.nullMx ? `${s.domain} refuses all email (null MX)` : `${s.domain} is not a registered domain`, s.nullMx ? "DNS" : s.rdapSource);
    } else if (s.hasMx === null) {
      info("S-DEAD-DOMAIN", `Couldn't check mail records for ${s.domain}`, "DNS", "couldnt_verify");
    }

    const freemail = s.freeMail && input.namesEmployer;
    if (freemail) fire("S-FREEMAIL", `${s.domain} is a free email service, but the message names an employer`, "free-email-domains list");

    if (s.atsSender) {
      info("S-MISMATCH", `${s.domain} is a hiring platform recruiters commonly send from`, "JobSeance ATS list");
    } else if (official) {
      info("S-MISMATCH", `Sender domain matches ${s.domain}, an official ${input.claimed!.name} domain`, "JobSeance company list");
    } else if (input.claimed && !freemail && input.claimed.officialDomains.length === 0) {
      // Missing data never counts: without official domains on file there is nothing to compare.
      info("S-MISMATCH", `We don't have ${input.claimed.name}'s official domains on file`, "JobSeance company list", "couldnt_verify");
    } else if (input.claimed && !freemail) {
      fire("S-MISMATCH", `${s.domain} is not an official ${input.claimed.name} domain`, "JobSeance company list");
    }

    const reportable = !s.freeMail && !s.disposable && !s.atsSender && !anyOfficial;
    if (reportable && s.reporters > 0) {
      const many = s.reporters >= REPORTED.manyFrom;
      fire(
        "S-REPORTED",
        `${s.reporters} JobSeance user${s.reporters > 1 ? "s" : ""} reported messages from ${s.domain}`,
        "JobSeance user reports",
        many ? SCAM_POINTS["S-REPORTED"] : REPORTED.fewPoints,
      );
    }
  }

  const m = input.mail;
  if (m) {
    const src = "the email's Authentication-Results header";
    if (m.malformed || !m.fromDomain) {
      info("S-AUTH-FAIL", "Couldn't read the pasted headers (they need exactly one From line)", "pasted headers", "couldnt_verify");
    } else if (!m.results) {
      info("S-AUTH-FAIL", "The pasted headers have no authentication results to check", "pasted headers", "couldnt_verify");
    } else {
      const from = m.fromDomain;
      const aligned =
        m.results.dkim.some((d) => d.result === "pass" && d.domain === from) || (m.results.spf?.result === "pass" && m.results.spf.domain === from);
      const policy = m.results.dmarc?.policy ?? m.publishedPolicy;
      const dmarc = m.results.dmarc?.result;
      if (dmarc === "fail") {
        fire("S-AUTH-FAIL", `Mail authentication failed for ${from} (DMARC fail, as recorded in the headers you pasted)`, src);
      } else if (dmarc === "pass") {
        info("S-AUTH-FAIL", `Mail authentication passed for ${from} (DMARC pass, as recorded in the headers you pasted)`, src);
      } else if (!aligned && (policy === "reject" || policy === "quarantine")) {
        fire("S-AUTH-FAIL", `No passing SPF or DKIM for ${from}, which asks mail servers to ${policy} such mail`, src);
      } else if (aligned) {
        info("S-AUTH-FAIL", `${from} signed or authorized this mail (SPF or DKIM pass, as recorded in the headers you pasted)`, src);
      } else {
        info("S-AUTH-FAIL", `${from} publishes no DMARC policy and the mail wasn't authenticated, which proves nothing either way`, src, "couldnt_verify");
      }
    }
    if (!m.malformed && m.fromDomain && m.replyToDomain && m.replyToDomain !== m.fromDomain && !m.replyToAts) {
      fire("S-REPLY-TO", `Replies would go to ${m.replyToDomain}, not the sender's domain ${m.fromDomain}`, "the email's Reply-To header");
    }
  }

  const score = clamp(signals.reduce((sum, sig) => sum + sig.points, 0), 0, 100);
  return { score, band: bandFor(score), signals };
}

/** "This message shows 4 scam warning signs": never "scam" next to a company name. */
export const warningCount = (score: Score) => score.signals.filter((s) => s.points > 0).length;
