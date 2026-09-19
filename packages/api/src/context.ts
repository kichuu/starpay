import type { Session } from "@starpay/auth";
import type { Database } from "@starpay/db";

export type Context = {
  session: Session | null;
  db: Database;
};
