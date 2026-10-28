import { z } from "zod";
import { HttpError } from "@/lib/api";

// Zod schemas shared by the CRUD routes. z.strictObject everywhere: unknown keys are 400s.

const DAY = 86_400_000;
const isoDate = z
  .union([z.iso.date(), z.iso.datetime({ offset: true })], { error: "Use a date like 2026-10-15." })
  .transform((s) => new Date(s));
const pastDate = isoDate.refine((d) => d.getTime() <= Date.now() + DAY, "That date is in the future.");

export const OUTCOMES = ["APPLIED", "INTERVIEWING", "NO_RESPONSE", "REJECTED", "ROLE_CLOSED", "OFFER", "HIRED", "WITHDREW"] as const;
export const STAGES = ["APPLIED", "INTERVIEWED"] as const;
export const CHANNELS = ["EMAIL", "TEXT", "WHATSAPP", "TELEGRAM", "LINKEDIN", "OTHER"] as const;
export const FLAG_REASONS = ["personal_info", "fake", "harassment", "false_fact", "score_wrong", "privacy_request", "other"] as const;
export const FLAG_TARGETS = ["OUTCOME_REPORT", "SCAM_REPORT", "CHECK", "COMPANY", "SITE"] as const;

/** Notes are free text: refuse obvious contact details (no names or contacts of individuals). */
const CONTACT = /[\w.+-]{1,64}@[\w-]{1,63}\.[\w.]{1,253}|(?:\+?\d[\s().-]?){9,}/;
const note = z
  .string()
  .trim()
  .max(1000, "Keep the note under 1,000 characters.")
  .refine((s) => !CONTACT.test(s), "Leave out email addresses and phone numbers.");

export const reportCreate = z
  .strictObject({
    company: z.string().trim().min(1).max(100).optional(), // slug
    companyId: z.string().trim().min(1).max(40).optional(),
    postingId: z.string().trim().min(1).max(40).optional(),
    roleTitle: z.string().trim().min(1, "Enter the role title.").max(200),
    appliedAt: pastDate,
    lastInterviewAt: pastDate.nullable().optional(),
    lastContactAt: pastDate.nullable().optional(),
    stageReached: z.enum(STAGES).optional(),
    outcome: z.enum(OUTCOMES).optional(),
    note: note.optional(),
    firstHand: z.literal(true, { error: "Confirm this is your own first-hand experience." }),
  })
  .refine((b) => b.company || b.companyId, { message: "Choose a company.", path: ["company"] })
  .refine((b) => !b.lastInterviewAt || b.lastInterviewAt >= b.appliedAt, {
    message: "The interview can't be before you applied.",
    path: ["lastInterviewAt"],
  });

export const reportUpdate = z
  .strictObject({
    appliedAt: pastDate.optional(),
    lastInterviewAt: pastDate.nullable().optional(),
    lastContactAt: pastDate.nullable().optional(),
    stageReached: z.enum(STAGES).optional(),
    outcome: z.enum(OUTCOMES).optional(),
    note: note.nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "Send at least one field to change.", path: ["body"] });

export const scamReportCreate = z.strictObject({
  senderEmail: z.string().trim().min(3).max(254),
  channel: z.enum(CHANNELS),
  companyClaimed: z.string().trim().max(100).optional(),
  text: z.string().trim().min(1, "Paste the message text.").max(20_000),
  shareExcerpt: z.boolean().optional(), // opt in to storing a redacted excerpt
});

export const scamReportUpdate = z
  .strictObject({
    channel: z.enum(CHANNELS).optional(),
    companyClaimed: z.string().trim().max(100).nullable().optional(),
    removeExcerpt: z.literal(true).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "Send at least one field to change.", path: ["body"] });

export const checkUpdate = z.strictObject({ saved: z.boolean() });

const domainName = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/, "Use a domain like acme.com.");

/** Admin-curated employer careers hosts (presence check and page reading). Checked against officialDomains in lib/admin.ts. */
export const careersHostList = z.array(domainName).max(10, "At most 10 careers hosts.");

export const ATS_VALUES = ["GREENHOUSE", "LEVER", "ASHBY", "WORKDAY", "SMARTRECRUITERS", "WORKABLE", "RECRUITEE", "AMAZON", "NONE"] as const;

export const companyCreate = z
  .strictObject({
    name: z.string().trim().min(1).max(100),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Lowercase letters, digits and dashes.")
      .optional(),
    officialDomains: z.array(domainName).min(1, "Add at least one official domain.").max(10),
    ats: z.enum(ATS_VALUES),
    atsBoard: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,99})?$/, "Use the board token from the job-board URL (Workday: tenant/site).")
      .optional(),
    /** Workday only: the career site's host, e.g. acme.wd5.myworkdayjobs.com. */
    atsHost: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9-]{0,62}\.wd\d{1,3}\.myworkday(?:jobs|site)\.com$/, "Use the Workday host, like acme.wd5.myworkdayjobs.com.")
      .optional(),
    careersHosts: careersHostList.optional(),
  })
  .refine((b) => (b.ats === "NONE") === !b.atsBoard, {
    message: "A board token is required for every job-board system, and not allowed for NONE.",
    path: ["atsBoard"],
  })
  .refine((b) => (b.ats === "WORKDAY") === Boolean(b.atsHost), { message: "Workday needs its host; other systems don't take one.", path: ["atsHost"] })
  .refine((b) => (b.ats === "WORKDAY") === Boolean(b.atsBoard?.includes("/")), { message: "Workday boards are tenant/site; others have no slash.", path: ["atsBoard"] })
  // amazon.jobs searches all of Amazon: it can only ever be Amazon's own board.
  .refine((b) => b.ats !== "AMAZON" || b.atsBoard === "amazon", { message: "amazon.jobs is only Amazon's board (atsBoard \"amazon\").", path: ["atsBoard"] });

/** PATCH /api/v1/companies/:slug (admin): the hand-curated fields only. */
export const companyUpdate = z
  .strictObject({
    officialDomains: z.array(domainName).min(1, "Add at least one official domain.").max(10).optional(),
    careersHosts: careersHostList.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "Send at least one field to change.", path: ["body"] });

export const FLAG_RESOLUTIONS = ["UNDER_REVIEW", "UPHELD", "REJECTED"] as const;

/** PATCH /api/v1/flags/:id (admin). */
export const flagUpdate = z.strictObject({
  status: z.enum(FLAG_RESOLUTIONS),
  resolutionNote: z.string().trim().max(1000).optional(),
});

/** POST /api/v1/admin/ai-pause. */
export const aiPauseBody = z.strictObject({ paused: z.boolean() });

export const companyQuery = z.strictObject({
  q: z.string().trim().max(100).optional(),
  ats: z.enum(ATS_VALUES).optional(),
});

export const flagCreate = z.strictObject({
  targetType: z.enum(FLAG_TARGETS),
  targetId: z.string().trim().min(1).max(100),
  reason: z.enum(FLAG_REASONS),
  details: z.string().trim().min(1, "Tell us what's wrong.").max(1000),
  reporterEmail: z.email().max(254).optional(),
});

/** Prisma unique-constraint violation → 409. */
export function conflictOn(error: unknown, field: string, message: string): never {
  if ((error as { code?: string } | null)?.code === "P2002") {
    throw new HttpError({ status: 409, code: "conflict", message, fields: { [field]: message } });
  }
  throw error;
}
