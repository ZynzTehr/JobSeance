import { startOAuth } from "@/lib/auth/pages";

// Passport ends the response itself; this silences "API resolved without sending a response".
export const config = { api: { externalResolver: true } };
export default startOAuth("google");
