import { createAuth } from "@starpay/auth";
import { createPrismaClient } from "@starpay/db";

import { ENV } from "./env.server";

export const db = createPrismaClient(ENV);
export const auth = createAuth(ENV, db);
