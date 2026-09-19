import { ORPCError, os } from "@orpc/server";
import { DomainError } from "@starpay/core";

/** Turns DomainErrors into typed oRPC errors; everything else stays a 500. */
export const mapDomainErrors = os.middleware(async ({ next }) => {
	try {
		return await next();
	} catch (error) {
		if (error instanceof DomainError) {
			throw new ORPCError(error.code, {
				status: error.status,
				message: error.message,
				data: error.data,
			});
		}
		throw error;
	}
});
