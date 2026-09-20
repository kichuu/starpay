import { z } from "zod";

/**
 * Server configuration, read from process.env.
 *
 * Nothing loads .env files at runtime: in development `varlock run` (see the
 * dev:bare script) resolves .env.schema/.env and injects the values; on Prisma
 * Compute the platform injects them. Keep this in sync with .env.schema.
 */
const schema = z.object({
	NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
	BETTER_AUTH_SECRET: z.string().min(32),
	BETTER_AUTH_URL: z.url(),
	CORS_ORIGIN: z.url(),
	DATABASE_URL: z.string().min(1),
	ENCRYPTION_KEY: z.string().min(44),
	PUBLIC_API_URL: z.url(),
	WORKER_ENABLED: z.stringbool().default(true),
	/** Comma-separated user IDs allowed into the platform admin. */
	PLATFORM_ADMIN_USER_IDS: z
		.string()
		.default("")
		.transform((value) =>
			value
				.split(",")
				.map((id) => id.trim())
				.filter(Boolean),
		),
	/** USD Telegram pays per Star; used to convert payouts to TON. */
	STAR_USD_RATE: z.coerce.number().positive().default(0.013),
	/** Hot-wallet mnemonics (24 words) for automatic payouts. Unset = manual payouts. */
	TON_PAYOUT_MNEMONIC_LIVE: z.string().optional(),
	TON_PAYOUT_MNEMONIC_TEST: z.string().optional(),
	TONCENTER_API_KEY: z.string().optional(),
});

function loadEnv() {
	const result = schema.safeParse(process.env);
	if (!result.success) {
		// Name the variables only; never print values, some are secrets.
		const problems = result.error.issues.map(
			(issue) => `  ${issue.path.join(".")}: ${issue.message}`,
		);
		throw new Error(`Invalid server environment:\n${problems.join("\n")}`);
	}
	return result.data;
}

export const ENV = loadEnv();
