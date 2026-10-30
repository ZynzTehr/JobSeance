// Outbound email through Postmark's HTTP API, called with plain fetch. Off unless
// EMAIL_ENABLED=1, POSTMARK_SERVER_TOKEN and EMAIL_FROM are all set; while off, nothing
// is sent and every email-dependent route and link is hidden. Logs carry status codes only.

export const POSTMARK_URL = "https://api.postmarkapp.com/email";
const SEND_TIMEOUT_MS = 5_000;

type EmailEnv = Readonly<Record<string, string | undefined>>; // reads EMAIL_ENABLED, POSTMARK_SERVER_TOKEN, EMAIL_FROM, USE_FIXTURES

export function emailEnabled(env: EmailEnv = process.env): boolean {
  return env.EMAIL_ENABLED === "1" && Boolean(env.POSTMARK_SERVER_TOKEN) && Boolean(env.EMAIL_FROM);
}

export type Email = { to: string; subject: string; text: string; html: string };

/** The JSON body Postmark's /email endpoint takes. Open and link tracking are always off. */
export function postmarkBody(from: string, email: Email) {
  return {
    From: from,
    To: email.to,
    Subject: email.subject,
    TextBody: email.text,
    HtmlBody: email.html,
    MessageStream: "outbound",
    TrackOpens: false,
    TrackLinks: "None",
  };
}

/**
 * Sends one email. Never throws: returns false when email is off, under USE_FIXTURES=1,
 * or when Postmark refuses or times out, so callers can carry on without leaking why.
 */
export async function sendEmail(email: Email, env: EmailEnv = process.env): Promise<boolean> {
  if (!emailEnabled(env)) return false;
  if (env.USE_FIXTURES === "1") {
    console.log("email_skipped reason=fixtures");
    return false;
  }
  try {
    const response = await fetch(POSTMARK_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": env.POSTMARK_SERVER_TOKEN!,
      },
      body: JSON.stringify(postmarkBody(env.EMAIL_FROM!, email)),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (response.ok) return true;
    // Postmark's ErrorCode is a number; its Message can echo the address, so it is never logged.
    const data = (await response.json().catch(() => null)) as { ErrorCode?: unknown } | null;
    const code = typeof data?.ErrorCode === "number" ? data.ErrorCode : -1;
    console.error(`email_send_failed status=${response.status} code=${code}`);
    return false;
  } catch {
    console.error("email_send_failed status=0 code=-1");
    return false;
  }
}
