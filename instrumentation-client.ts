import { initBotId } from "botid/client/core";

// Vercel BotID: adds a challenge header to these requests so the server can tell a
// browser from a script. The challenge script loads only when one of them is sent.
// Keep this list in step with the routes that call checkBotId (lib/bot-guard.ts).
initBotId({
  protect: [
    { path: "/api/auth/signup", method: "POST" },
    { path: "/api/auth/login", method: "POST" },
    { path: "/api/v1/flags", method: "POST" },
    { path: "/api/v1/checks", method: "POST" },
  ],
});

