// Fields an author sees for their own outcome reports (never shown publicly).
export const ownReportSelect = {
  id: true,
  roleTitle: true,
  appliedAt: true,
  lastInterviewAt: true,
  lastContactAt: true,
  stageReached: true,
  outcome: true,
  note: true,
  visibility: true,
  postingId: true,
  createdAt: true,
  updatedAt: true,
  company: { select: { slug: true, name: true, isFictional: true } },
} as const;

// Fields an author sees for their own scam reports.
export const ownScamReportSelect = {
  id: true,
  senderDomain: true,
  companyClaimed: true,
  channel: true,
  ruleIds: true,
  scamScore: true,
  redactedExcerpt: true,
  visibility: true,
  createdAt: true,
} as const;
