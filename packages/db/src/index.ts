import { PrismaPostgresAdapter } from "@prisma/adapter-ppg";

import { PrismaClient } from "../prisma/generated/client";
import type { DatabaseConfig } from "./config";

export function createPrismaClient(env: DatabaseConfig) {
  const adapter = new PrismaPostgresAdapter({
    connectionString: env.DATABASE_URL,
  });

  return new PrismaClient({ adapter });
}

export type Database = ReturnType<typeof createPrismaClient>;
