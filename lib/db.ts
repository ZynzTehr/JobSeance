import { parseEnv } from "@neon/env";
import { PrismaNeon } from "@prisma/adapter-neon";
import neonConfig from "@/neon";
import { PrismaClient } from "@/app/generated/prisma/client";

// One client per server instance. In dev, hot reload re-runs this module,
// so the client lives on globalThis instead of being recreated every edit.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  // App traffic uses the pooled URL; the Prisma CLI uses DATABASE_URL_UNPOOLED.
  // parseEnv throws a clear error naming the variable if it is missing.
  const { postgres } = parseEnv(neonConfig, ["DATABASE_URL"]);
  const adapter = new PrismaNeon({ connectionString: postgres.databaseUrl });
  return new PrismaClient({ adapter });
}

// Lazy, so `next build` can import route modules without a database URL.
export function getDb(): PrismaClient {
  globalForPrisma.prisma ??= createClient();
  return globalForPrisma.prisma;
}
