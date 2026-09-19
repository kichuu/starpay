import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../prisma/generated/client";
import type { DatabaseConfig } from "./config";

export function createPrismaClient(env: DatabaseConfig) {
	const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

	return new PrismaClient({ adapter });
}

export type Database = ReturnType<typeof createPrismaClient>;

/** A Prisma client or an interactive-transaction client. Services accept either. */
export type Tx = Omit<
	Database,
	"$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

export * from "../prisma/generated/client";
