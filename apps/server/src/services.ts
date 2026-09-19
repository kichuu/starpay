import { createAuth } from "@starpay/auth";
import { createDeps, createServices } from "@starpay/core";
import { createPrismaClient } from "@starpay/db";

import { ENV } from "./env.server";

export const db = createPrismaClient(ENV);
export const auth = createAuth(ENV, db);
export const services = createServices(
	createDeps(db, {
		publicApiUrl: ENV.PUBLIC_API_URL,
		encryptionKey: ENV.ENCRYPTION_KEY,
	}),
);
