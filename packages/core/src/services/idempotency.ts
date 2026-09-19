import { Prisma } from "@starpay/db";

import { sha256Hex } from "../crypto";
import type { Deps, Scope } from "../deps";
import { errors } from "../errors";
import { toJson } from "../serializers";

/**
 * Replays the stored response for a repeated Idempotency-Key. Only successful
 * responses are stored, so a failed request can be retried with the same key.
 */
export function createIdempotencyService(deps: Deps) {
	const { db } = deps;

	return {
		async run<T>(
			scope: Scope,
			key: string | undefined,
			request: unknown,
			fn: () => Promise<T>,
		): Promise<T> {
			if (!key) return fn();
			const requestHash = sha256Hex(JSON.stringify(request));
			const where = {
				organizationId_mode_key: {
					organizationId: scope.organizationId,
					mode: scope.mode,
					key,
				},
			};

			const existing = await db.idempotencyRecord.findUnique({ where });
			if (existing) {
				if (existing.requestHash !== requestHash)
					throw errors.idempotencyKeyReused();
				return existing.response as T;
			}

			const result = await fn();
			try {
				await db.idempotencyRecord.create({
					data: {
						...where.organizationId_mode_key,
						requestHash,
						statusCode: 200,
						response: toJson(result),
					},
				});
			} catch (error) {
				// A concurrent request with the same key won the race; both did the work once each
				// only if fn isn't itself idempotent, which is why keys should be unique per intent.
				if (
					!(
						error instanceof Prisma.PrismaClientKnownRequestError &&
						error.code === "P2002"
					)
				)
					throw error;
			}
			return result;
		},
	};
}
