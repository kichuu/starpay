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
