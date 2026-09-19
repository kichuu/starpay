import { execSync } from "node:child_process";
import path from "node:path";

export const TEST_DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	"postgresql://starpay:starpay@localhost:5433/starpay_test";

/**
 * Applies pending migrations to the test database. Non-destructive: tests stay
 * independent by using a fresh organization ID each, not by wiping tables.
 * Needs `docker compose up -d` and the starpay_test database (see README).
 */
export default function setup() {
	execSync("pnpm exec prisma migrate deploy", {
		cwd: path.resolve(import.meta.dirname, "../../db"),
		env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
		stdio: "pipe",
	});
}
