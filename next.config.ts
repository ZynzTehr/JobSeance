import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      // Tailwind runs on plain stylesheets only. Without the condition it
      // would also process CSS Modules and strip their class-name scoping.
      "*.css": {
        condition: { not: { path: /\.module\.css$/ } },
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// Adds the rewrites that serve Vercel BotID's challenge script from our own domain.
export default withBotId(nextConfig);
