import type { ErrorCode } from "@starpay/contracts";

/**
 * A failure the caller can act on. The API layer maps these to oRPC errors
 * (status + code); anything else becomes a 500.
 */
export class DomainError extends Error {
	constructor(
		readonly code: ErrorCode | "NOT_FOUND" | "BAD_REQUEST" | "CONFLICT",
		readonly status: number,
		message: string,
		readonly data?: Record<string, unknown>,
	) {
		super(message);
		this.name = "DomainError";
	}
}

export const errors = {
	badRequest: (message: string, param?: string) =>
		new DomainError("BAD_REQUEST", 400, message, param ? { param } : undefined),
	conflict: (message: string) => new DomainError("CONFLICT", 409, message),
	notFound: (what: string, id: string) =>
		new DomainError("NOT_FOUND", 404, `No such ${what}: ${id}`),

	botNotConnected: () =>
		new DomainError(
			"BOT_NOT_CONNECTED",
			409,
			"Connect a Telegram bot for this mode before creating orders",
		),
	botTokenInvalid: () =>
		new DomainError(
			"BOT_TOKEN_INVALID",
			400,
			"Telegram rejected this bot token",
		),
	productNotFound: (id: string) =>
		new DomainError("PRODUCT_NOT_FOUND", 404, `No such product: ${id}`, {
			param: "product",
		}),
	productArchived: (id: string) =>
		new DomainError("PRODUCT_ARCHIVED", 409, `Product ${id} is archived`, {
			param: "product",
		}),
	orderNotFound: (id: string) =>
		new DomainError("ORDER_NOT_FOUND", 404, `No such order: ${id}`),
	orderNotRefundable: (id: string, status: string) =>
		new DomainError(
			"ORDER_NOT_REFUNDABLE",
			409,
			`Order ${id} is ${status}; only paid orders can be refunded`,
		),
	orderNotCancellable: (id: string, status: string) =>
		new DomainError(
			"ORDER_NOT_CANCELLABLE",
			409,
			`Order ${id} is ${status}; only unpaid orders can be cancelled`,
		),
	idempotencyKeyReused: () =>
		new DomainError(
			"IDEMPOTENCY_KEY_REUSED",
			409,
			"This Idempotency-Key was already used with a different request",
		),
	telegram: (description: string) =>
		new DomainError("TELEGRAM_ERROR", 502, `Telegram error: ${description}`),
};
