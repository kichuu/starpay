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
	payoutAddressMissing: () =>
		new DomainError(
			"PAYOUT_ADDRESS_MISSING",
			409,
			"Add a TON wallet address in Settings before requesting a payout",
		),
	payoutBelowMinimum: (minimum: number) =>
		new DomainError(
			"PAYOUT_BELOW_MINIMUM",
			400,
			`The minimum payout is ${minimum} Stars`,
			{ param: "amount" },
		),
	insufficientBalance: (withdrawable: number, needed: number) =>
		new DomainError(
			"INSUFFICIENT_BALANCE",
			409,
			`You can withdraw ${withdrawable} Stars; this payout needs ${needed} including fees`,
			{ withdrawable, needed },
		),
	payoutPricingUnavailable: () =>
		new DomainError(
			"PAYOUT_NOT_ALLOWED",
			503,
			"Payout pricing is unavailable right now; try again shortly",
		),
	payoutNotAllowed: (id: string, status: string) =>
		new DomainError("PAYOUT_NOT_ALLOWED", 409, `Payout ${id} is ${status}`),
	notHosted: () =>
		new DomainError(
			"NOT_HOSTED",
			409,
			"Balances and payouts apply to payments taken through StarPay's bot",
		),
	telegram: (description: string) =>
		new DomainError("TELEGRAM_ERROR", 502, `Telegram error: ${description}`),
};
