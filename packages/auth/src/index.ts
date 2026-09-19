import type { Database } from "@starpay/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { bearer, organization } from "better-auth/plugins";

import { ac, roles } from "./roles";

export type AuthConfig = {
	BETTER_AUTH_URL: string;
	BETTER_AUTH_SECRET: string;
	CORS_ORIGIN: string;
};

export function createAuth(
	env: AuthConfig,
	database: Database,
	desktopOrigins: readonly string[] = [],
) {
	return betterAuth({
		database: prismaAdapter(database, {
			provider: "postgresql",
		}),
		trustedOrigins: [env.CORS_ORIGIN, ...desktopOrigins],
		emailAndPassword: { enabled: true },
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		advanced: {
			defaultCookieAttributes: {
				sameSite: "none",
				secure: true,
				httpOnly: true,
			},
		},
		plugins: [
			// Merchant = organization. The creator becomes the owner.
			organization({ ac, roles, creatorRole: "owner" }),
			// Bearer sessions for the Telegram Mini App, where cookies are unreliable.
			bearer(),
		],
	});
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];

export { type MemberRole, ROLE_RANK } from "./roles";
