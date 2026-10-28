// Versioned scoring config (spec "Ghost-risk score" and "Scam-risk score").
// Weights are expert-set from public benchmarks, not validated. Every check
// stores CONFIG_VERSION so old results can be explained after a change.

export const CONFIG_VERSION = "2026-10-28.1";

export const BANDS = { cautionFrom: 25, highFrom: 50 } as const;

// ---- Ghost rubric -----------------------------------------------------------

export const GHOST = {
  notOnBoard: 25,
  /** Days listed → points, from the board's own date. First match wins. */
  age: [
    { maxDays: 60, points: 0 },
    { maxDays: 90, points: 5 },
    { maxDays: 180, points: 10 },
    { maxDays: Infinity, points: 15 },
  ],
  evergreen: 15,
  noVacancy: 25,
  community: { max: 30, hiredPenalty: -20, windowDays: 180, ghostedAfterDays: 45, minReporters: 3, interviewWeight: 2 },
} as const;

export type Phrase = { label: string; re: RegExp };
const p = (label: string, re?: RegExp): Phrase => ({
  label,
  re: re ?? new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")}\\b`, "i"),
});

// "Talent pool" counts only as pipeline wording ("join our talent pool"), not in
// diversity boilerplate like "the broadest talent pool possible".
const POOL_VERBS = "join(?:ing)?|added\\s+to|add\\s+you\\s+to|enter(?:ed)?|in(?:to)?|for|part\\s+of|build(?:ing)?|grow(?:ing)?";
export const EVERGREEN_PHRASES: Phrase[] = [
  p("talent pool", new RegExp(`\\b(?:${POOL_VERBS})\\s+(?:our|the|a|this)\\s+talent\\s+pool\\b`, "i")),
  p("talent community", new RegExp(`\\b(?:${POOL_VERBS})\\s+(?:our|the|a|this)\\s+talent\\s+community\\b`, "i")),
  p("always accepting"),
  // Applying for later roles ("interested in future opportunities"), not "shape future
  // opportunities" or an internship's "consideration for future opportunities".
  p("future opportunities", /\b(?:interested\s+in|apply(?:ing)?\s+for|applications?\s+for|considered\s+for|about)\s+(?:potential\s+|other\s+)?future\s+opportunities\b/i),
  p("general application"),
];

export const NO_VACANCY_PHRASES: Phrase[] = [
  p("not an existing vacancy"),
  p("no current vacancy"),
  p("collecting resumes for future openings", /\bcollecting\s+(resumes|résumés|cvs)\s+for\s+future\s+openings\b/i),
];

// ---- Scam rules ---------------------------------------------------------------

const FTC_JOB_SCAMS = "https://consumer.ftc.gov/articles/job-scams";
const FTC_JUL_2025 = "https://consumer.ftc.gov/consumer-alerts/2025/07/job-scammers-are-looking-hire-you";
const IC3_2020 = "https://www.ic3.gov/PSA/2020/PSA200121";

export type ScamRuleId =
  | "S-PAY-TO-WORK"
  | "S-FAKE-CHECK"
  | "S-DISPOSABLE"
  | "S-LOOKALIKE"
  | "S-DOMAIN-NEW"
  | "S-TASK-SCAM"
  | "S-PII-EARLY"
  | "S-RESHIP"
  | "S-FREEMAIL"
  | "S-PAYMENT-METHOD"
  | "S-DEAD-DOMAIN"
  | "S-RUN-CODE"
  | "S-MISMATCH"
  | "S-NOT-ON-BOARD"
  | "S-CHAT-ONLY"
  | "S-REPORTED"
  | "S-NO-INTERVIEW"
  | "S-TOO-GOOD"
  | "S-AUTH-FAIL"
  | "S-REPLY-TO";

export const SCAM_POINTS = {
  "S-PAY-TO-WORK": 30,
  "S-FAKE-CHECK": 30,
  "S-DISPOSABLE": 30,
  "S-LOOKALIKE": 25,
  "S-DOMAIN-NEW": 25, // under 30 days
  "S-TASK-SCAM": 25,
  "S-PII-EARLY": 25,
  "S-RESHIP": 25,
  "S-FREEMAIL": 20,
  "S-PAYMENT-METHOD": 20,
  "S-DEAD-DOMAIN": 20,
  "S-RUN-CODE": 20,
  "S-MISMATCH": 15,
  "S-NOT-ON-BOARD": 15,
  "S-CHAT-ONLY": 15,
  "S-REPORTED": 25, // 3+ reporters
  "S-NO-INTERVIEW": 10,
  "S-TOO-GOOD": 10,
  "S-AUTH-FAIL": 20, // from pasted headers only
  "S-REPLY-TO": 15, // from pasted headers only
} as const satisfies Record<ScamRuleId, number>;

export const DOMAIN_NEW = { newDays: 30, youngDays: 180, youngPoints: 10 } as const;
export const REPORTED = { fewPoints: 15, manyFrom: 3 } as const;

export const SCAM_CITES: Record<ScamRuleId, string | undefined> = {
  "S-PAY-TO-WORK": FTC_JOB_SCAMS,
  "S-FAKE-CHECK": FTC_JOB_SCAMS,
  "S-DISPOSABLE": undefined, // domain lists, not a government source
  "S-LOOKALIKE": "https://www.ic3.gov/PSA/2022/PSA220201",
  "S-DOMAIN-NEW": IC3_2020,
  "S-TASK-SCAM": "https://consumer.ftc.gov/consumer-alerts/2025/08/how-spot-avoid-task-scams",
  "S-PII-EARLY": FTC_JUL_2025,
  "S-RESHIP": "https://www.ic3.gov/PSA/2026/PSA261013",
  "S-FREEMAIL":
    "https://consumer.ftc.gov/consumer-alerts/2023/08/scammers-impersonate-well-known-companies-recruit-fake-jobs-linkedin-other-job-platforms",
  "S-PAYMENT-METHOD":
    "https://www.ftc.gov/news-events/data-visualizations/data-spotlight/2024/12/paying-get-paid-gamified-job-scams-drive-record-losses",
  "S-DEAD-DOMAIN": "https://www.rfc-editor.org/rfc/rfc7505",
  "S-RUN-CODE": "https://www.ic3.gov/CSA/2026/260918.pdf",
  "S-MISMATCH": IC3_2020,
  "S-NOT-ON-BOARD": IC3_2020,
  "S-CHAT-ONLY": "https://consumer.ftc.gov/consumer-alerts/2026/04/job-offer-text-probably-scam",
  "S-REPORTED": undefined, // our own data
  "S-NO-INTERVIEW": FTC_JUL_2025,
  "S-TOO-GOOD": FTC_JOB_SCAMS,
  "S-AUTH-FAIL": "https://www.rfc-editor.org/rfc/rfc7489",
  "S-REPLY-TO": "https://consumer.ftc.gov/articles/how-recognize-and-avoid-phishing-scams",
};

const PAYMENT_TARGETS = "gift\\s+cards?|bitcoin|btc|usdt|crypto(?:currency)?|zelle|cash\\s*app|wire\\s+transfer|western\\s+union|moneygram";
const PAY_VERBS = "pay|paid|payment|send|sent|buy|purchase|transfer|deposit";

/**
 * An employer's own anti-fraud notice ("our recruiters will never ask for your
 * Social Security number") must not count as the scam it warns about. A scam
 * phrase is skipped when the same sentence, just before it, is still inside a
 * "never/not/won't/don't … ask/request/require/need" clause. A turn back to
 * instructions ends that clause, so "We don't require an interview, just send
 * your SSN" and "Don't worry, all we need is your SSN" still fire.
 */
const NOTICE_NEG = "(?:never|not|won['’]?t|don['’]?t|doesn['’]?t|cannot|can['’]?t)";
const NOTICE_ASK = "(?:ask|request|require|need|solicit)(?:s|ed)?";
// A turn back to instructions ends the notice: "…, just send", "all we need is", "please add me".
const NOTICE_BREAK = "[;:]|\\b(?:just|but|only|simply|instead|however|kindly|please|all|is|are|will|we|so|then)\\b|,\\s*(?:you|we|i|they|he|she|this|the|our|my)\\b";
export const ANTI_FRAUD_NOTICE = new RegExp(`\\b${NOTICE_NEG}\\s+(?:\\w+\\s+){0,2}?${NOTICE_ASK}\\b(?:(?!${NOTICE_BREAK})[\\s\\S]){0,120}$`, "i");

/**
 * Phrase rules. A signal's fact quotes only the matching entry's label, never
 * the surrounding text. Broad words that appear in real job descriptions
 * ("optimization", "signal", "bitcoin") are narrowed to their scam context.
 */
export const SCAM_PHRASES: Partial<Record<ScamRuleId, Phrase[]>> = {
  "S-PAY-TO-WORK": [
    p("starter kit"),
    p("training fee"),
    p("registration fee"),
    p("background check fee"),
    p("buy equipment from our vendor", /\b(buy|purchase)\s+(the\s+)?equipment\s+from\s+(our|a|the|my)\s+(approved\s+)?vendor\b/i),
  ],
  "S-FAKE-CHECK": [
    p("deposit the check", /\bdeposit\s+(the|this|your|a)\s+(cheque|check)\b/i),
    p("mobile deposit"),
    p("send the remaining"),
    // Only the refund ask, not "apply holds to prevent overpayment" in a finance role.
    p(
      "overpayment",
      /\boverpa(?:id|yment)\b[^.]{0,60}\b(?:refund|return|send\s+(?:it\s+)?back|wire|difference)\b|\b(?:refund|return|send\s+back)\b[^.]{0,40}\boverpa(?:id|yment)\b|\boverpa(?:id|yment)\b[\s\S]{0,100}?\b(?:return|send|forward|wire|transfer|reimburse|pay\s+back)\b[^.]{0,30}\b(?:excess|extra|difference|remaining|remainder)\b/i,
    ),
  ],
  "S-TASK-SCAM": [
    // Only with pay nearby: "app optimization tasks ... earn commission", not "automatic data optimization".
    p(
      "optimization tasks",
      // Only app/order/product optimization may look past the sentence end; "data optimization"
      // is common in real postings and fires only next to merchants/orders/sets.
      /\b(?:(?:app|data|order|product|review)\s+optimi[sz]ation|optimi[sz]ation\s+tasks?)\b(?=[^.]{0,80}\b(?:earn\w*|paid|pay|commissions?|income|salary|per\s+(?:day|task|order|set))\b)|\b(?:earn\w*|paid|commissions?|income)\b[^.]{0,80}\b(?:app|order|product|data)\s+optimi[sz]ation\b|\b(?:app|order|product)\s+optimi[sz]ation\b(?=[\s\S]{0,150}\b(?:earn\w*|commissions?|income|salary|per\s+(?:day|task|order|set))\b)|\bdata\s+optimi[sz]ation\b[^.]{0,60}\b(?:merchants?|orders?|sets?)\b/i,
    ),
    p("product boosting"),
    p("rate or like products for pay", /\b(rate|like|review)\s+(products|apps|videos)\b[^.]{0,60}\b(earn|paid|pay|commission)\b/i),
    p("level up your account", /\blevel\s+up\s+(your\s+)?(account|vip|tier)\b/i),
    p("commission per task", /\bcommission\s+(per|for\s+each)\s+(task|order)\b/i),
  ],
  "S-PII-EARLY": [
    p("social security number", /\b(social\s+security\s+(number|no\.?)|ssn)\b/i),
    // Being asked to send it, not "must have a driver's licence" as a job requirement.
    p(
      "driver's license",
      /\b(?:send|provide|upload|share|email|text|submit)\s+(?:us\s+|me\s+)?(?:an?\s+)?(?:(?:photo|picture|copy|scan|image)\s+of\s+)?(?:your\s+)?driver['’]?s\s+licen[cs]e\b|\bdriver['’]?s\s+licen[cs]e\s+\(?(?:photos?|pictures?|pics?|cop(?:y|ies)|scans?|number|front)\b|\b(?:photos?|pictures?|pics?|cop(?:y|ies)|scans?|images?|sides|front(?:\s+and\s+back)?|back)\s+of\s+(?:the\s+front\s+and\s+back\s+of\s+)?your\s+(?:[\w-]+\s+){0,2}?driver['’]?s\s+licen[cs]e\b/i,
    ),
    p("bank account number", /\bbank\s+(account\s+)?(number|details|info(rmation)?)\b/i),
    p("routing number"),
    p("card number", /\b(credit|debit)\s+card\s+(number|details)\b/i),
  ],
  "S-RESHIP": [
    p("reship", /\breship(ping|ment)?\b/i),
    p("forward packages", /\bforward(ing)?\s+(the\s+)?packages\b/i),
    p("receive laptops", /\breceiv(e|ing)\s+(the\s+)?laptops\b/i),
    p("keep the laptop online"),
    p("interview on behalf of"),
  ],
  "S-PAYMENT-METHOD": [
    // As a way to pay, not "tipping, gift cards" as a product feature.
    p(
      "gift cards",
      /\b(?:buy|purchase|send|get|use|pick\s+up|pay\s+(?:for\s+)?(?:with|in|using)|paid\s+(?:for\s+)?(?:with|in|using)|funds?\s+(?:for|on|to))\s+(?:[\w$.,]+\s+){0,4}?gift\s+cards?\b|\bgift\s+cards?\b[^.]{0,60}\b(?:codes?|pins?|back\s+of)\b|\bgift\s+card\s+(?:codes?|numbers?|pins?)\b/i,
    ),
    p("USDT", /\busdt\b/i),
    p("crypto wallet", /\bcrypto(currency)?\s+wallet\b/i),
    p("Zelle", /\bzelle\b/i),
    p("Cash App", /\bcash\s*app\b/i),
    p("wire transfer", /\bwire\s+transfer\b/i),
    // Paying or being paid in it ("we pay you in USDT", "send $500 in Bitcoin"), not "move crypto on Coinbase".
    p(
      "pay in Bitcoin or crypto",
      new RegExp(
        [
          `\\b(?:pay|paid|payment|compensat\\w*|salary|wages?|earnings)\\s+(?:(?:will|is|are|be|been|made|sent|issued|weekly|daily|monthly|bi-?weekly|you|us)\\s+){0,3}(?:in|via|through|with|using)\\s+(?:\\w+\\s+){0,2}?(?:${PAYMENT_TARGETS})\\b`,
          `\\b(?:${PAY_VERBS})\\s+(?:the\\s+|your\\s+|some\\s+|\\$?\\d[\\d,.]*\\s+(?:in|of|worth\\s+of)\\s+)?(?:${PAYMENT_TARGETS})\\b`,
          `\\b(?:${PAY_VERBS})\\s+(?:it|them|this|the\\s+(?:rest|balance|remainder|remaining(?:\\s+\\w+)?|funds|money|cash))\\s+(?:in|via|through|using|by|with|to\\s+(?:a|the|my|our))\\s+(?:\\w+\\s+){0,1}?(?:${PAYMENT_TARGETS})\\b`,
          `\\b(?:deposit|insert|feed|take|bring|load|put)\\b[^.]{0,40}\\b(?:bitcoin|btc|crypto(?:currency)?)\\s+(?:atm|kiosk|machine)\\b`,
        ].join("|"),
        "i",
      ),
    ),
  ],
  "S-RUN-CODE": [
    p("clone a repo", /\bclone\s+(the|this|our|a|my)\s+(repo|repository)\b/i),
    p("npm install"),
    p("run the project", /\brun\s+(the|this|our)\s+(project|app|code)\s+(locally|on\s+your)/i),
    p(".vscode/tasks.json", /\.vscode\/tasks\.json/i),
  ],
  "S-CHAT-ONLY": [
    p("WhatsApp", /\bwhats\s?app\b/i),
    p("Telegram", /\btelegram\b/i),
    // The app, not the word: "on Signal" (capitalised), "message me on signal", "Signal app".
    // Lowercase "act on signal metadata" or "signal strength" must not fire.
    p(
      "Signal",
      /\b(?:on|via|through|over)\s+Signal\b(?!\s+(?:[Pp]rocessing|[Ss]trength|[Qq]uality|[Ii]ntegrity|[Dd]ata)\b)|\b(?:[Oo]n|[Vv]ia|[Tt]hrough|[Oo]ver|ON|VIA|THROUGH|OVER)\s+(?:signal|SIGNAL)(?=\s*(?:$|[.!?)]|:?\s*\+?\d|(?:at|AT)\s+\d|(?:app|messenger|now|today|asap|(?:for|FOR)\s+(?:the\s+|your\s+|an?\s+|THE\s+|YOUR\s+)?(?:interview|onboarding|details|further|next|INTERVIEW|ONBOARDING)|(?:to|TO)\s+(?:schedule|discuss|chat|talk|start|begin|continue|proceed|SCHEDULE|START)|APP)\b))|\b(?:[Mm]essage|[Tt]ext|[Cc]hat|[Cc]ontact|[Rr]each|[Aa]dd|[Cc]all|DM|[Pp]ing|MESSAGE|TEXT|CHAT|CONTACT|REACH|ADD|CALL)\s+(?:\w+\s+){0,3}?(?:on|via|over|ON|VIA|OVER)\s+(?:[Ss]ignal|SIGNAL)\b|\b(?:[Dd]ownload|[Ii]nstall)\s+(?:the\s+)?[Ss]ignal\b|\b[Ss]ignal\s+(?:[Aa]pp|[Mm]essenger)\b/,
    ),
    p("text me at"),
    p("reply YES", /\breply\s+["']?yes\b/i),
    p("interview by chat", /\binterview\b[^.]{0,40}\bby\s+chat\b|\bchat\s+interview\b/i),
  ],
  "S-NO-INTERVIEW": [
    p("respond within 24 hours", /\b(respond|reply|answer)\s+within\s+(24|48)\s+hours\b/i),
    p("hired without an interview", /\b(no|without\s+(an?\s+)?)\s*interview\s+(needed|required|necessary)\b|\bhired\s+without\s+an?\s+interview\b/i),
  ],
  "S-TOO-GOOD": [
    p("high pay per day or week", /\$\s?\d{3,}(?:,\d{3})*(?:\.\d+)?\s*(?:\/|per|a|each)\s*(?:day|week)\b/i),
  ],
};

// ---- Shared copy --------------------------------------------------------------

export const DISCLAIMER =
  "These scores are automated estimates based on the public signals and user reports listed above, checked at the time shown. They are our opinion, not a statement of fact about any company or person, and not a guarantee. A low score does not mean a job is safe. Community reports are users' own experiences and are not verified by JobSeance. JobSeance is not affiliated with the companies shown, the FTC or the FBI.";

export const VERIFICATION_CHECKLIST = [
  "Find this role on the company's official careers page. Type the company's address yourself; do not click links in the message.",
  "Contact the company using a phone number or email from its official site, not the one in the message.",
  "Never pay a fee, deposit a check, or share your SSN or bank details before a real interview and a written offer.",
] as const;

export const HIGH_SCAM_ADVICE = [
  { label: "Report it to the FTC", url: "https://reportfraud.ftc.gov" },
  { label: "Report it to the FBI's IC3", url: "https://www.ic3.gov/" },
  { label: "If you shared your SSN", url: "https://www.identitytheft.gov" },
  { label: "If you sent money, call your bank now", url: null },
  { label: "A JobSeance report does not notify the FTC or FBI.", url: null },
] as const;

export const RUN_CODE_NOTE = "Real take-home tests exist; run unknown code only in a sandbox.";
