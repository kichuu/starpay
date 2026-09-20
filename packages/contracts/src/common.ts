import { z } from "zod";

export const Mode = z.enum(["live", "test"]);
export type Mode = z.infer<typeof Mode>;

/** Whole Telegram Stars. */
export const Stars = z.int().nonnegative();

/** Telegram user/chat IDs fit in 52 bits, so a JS number is exact. */
export const TelegramId = z.coerce.number().int().positive();

export const prefixedId = (prefix: string) =>
	z.string().startsWith(`${prefix}_`).max(64);

export const Timestamp = z.iso.datetime();

export const Metadata = z
	.record(z.string().max(40), z.string().max(500))
	.refine((value) => Object.keys(value).length <= 20, {
		message: "At most 20 metadata keys",
	});

export const ListInput = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(20),
	/** Cursor: return items created before this ID. */
	starting_after: z.string().max(64).optional(),
});

export const listOf = <T extends z.ZodType>(item: T) =>
	z.object({
		object: z.literal("list"),
		data: z.array(item),
		has_more: z.boolean(),
	});

/**
 * Error codes returned in the `code` field of oRPC error responses, in
 * addition to oRPC's own (UNAUTHORIZED, NOT_FOUND, BAD_REQUEST, ...).
 */
export const ErrorCode = z.enum([
	"BOT_NOT_CONNECTED",
	"BOT_TOKEN_INVALID",
	"PRODUCT_NOT_FOUND",
	"PRODUCT_ARCHIVED",
	"ORDER_NOT_FOUND",
	"ORDER_NOT_REFUNDABLE",
	"ORDER_NOT_CANCELLABLE",
	"IDEMPOTENCY_KEY_REUSED",
	"TELEGRAM_ERROR",
	"FORBIDDEN_ROLE",
	"NO_ACTIVE_ORGANIZATION",
	"PAYOUT_ADDRESS_MISSING",
	"PAYOUT_BELOW_MINIMUM",
	"INSUFFICIENT_BALANCE",
	"PAYOUT_NOT_ALLOWED",
	"NOT_HOSTED",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;
