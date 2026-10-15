import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma 7.10 reads this file (never add a second prisma.config.ts).
// process.env, not env(), so `prisma generate` works with no database URL set.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: { url: process.env.DATABASE_URL_UNPOOLED },
});
