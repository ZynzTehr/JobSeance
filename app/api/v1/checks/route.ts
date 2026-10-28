import { after, type NextRequest } from "next/server";
import { handle, HttpError, readBody, reader, writer } from "@/lib/api";
import { jsonError } from "@/lib/auth/require-user";
import { rateLimit, tooManyRequests } from "@/lib/http";
import { CheckError, checkSchema, runCheck } from "@/lib/checks/run";
import { savedChecks } from "@/lib/saved-checks";
import { firedCueRules, haikuProvider, runShadow, shadowEligible, shadowProviderName } from "@/lib/ai/shadow";

export const dynamic = "force-dynamic";
/** AI reading, board searches and page reads share a 45-second deadline per check; this leaves headroom. */
export const maxDuration = 90;

/** GET /api/v1/checks: my saved checks, newest first. */
export const GET = handle(async (request: NextRequest) => {
  const user = await reader(request);
  return Response.json({ checks: await savedChecks(user.id) });
});

/** POST /api/v1/checks: the scanner. Signed in (every check needs an account), 60/min per account. */
export const POST = handle(async (request: NextRequest) => {
  const user = await writer(request); // 415 / 403 / 401 before anything else
  const limit = rateLimit(`scan:user:${user.id}`, 60, 60);
  if (!limit.ok) throw new HttpError(tooManyRequests(limit.retryAfter));

  const input = await readBody(request, checkSchema); // 413 / 400 with field errors
  try {
    const result = await runCheck(input, user.id);
    // Phase 13 shadow mode (off unless CUES_PROVIDER=haiku): only when this check already sent
    // the masked text to Anthropic. Runs after the response; stores numbers only, shows nothing.
    if ((input.kind === "posting_text" || input.kind === "message") && shadowEligible(input, "ai" in result ? result : {})) {
      const text = input.text;
      const fired = firedCueRules([...result.ghost.signals, ...result.scam.signals]);
      after(async () => {
        if ((await shadowProviderName().catch(() => null)) === "haiku") await runShadow({ checkId: result.id, text, fired }, haikuProvider());
      });
    }
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof CheckError) return jsonError(error.api);
    throw error;
  }
});
