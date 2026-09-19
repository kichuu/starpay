import path from "node:path";

import { defineConfig, env } from "prisma/config";
import "varlock/auto-load";

export default defineConfig({
  schema: path.join("prisma", "schema"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  datasource: {
    // Deploys pass MIGRATE_DATABASE_URL: varlock re-resolves DATABASE_URL from
    // local .env files when the parent process ran under varlock (as Alchemy does),
    // which would point migrations at the local database.
    url: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL!,
  },
});
