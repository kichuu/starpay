// Public JSON objects: the single source of truth for what /v1 returns and
// what merchant webhooks carry. snake_case on purpose (public REST API).
import { z } from "zod";

import { Metadata, prefixedId, Stars, TelegramId, Timestamp } from "./common";

export const ProductType = z.enum(["one_time", "subscription"]);
export const ProductStatus = z.enum(["active", "archived"]);
export const OrderStatus = z.enum([
	"created",
	"pre_checkout",
	"paid",
	"refunded",
	"expired",
	"failed",
]);
export const SubscriptionStatus = z.enum(["active", "cancelled", "expired"]);

export const ProductObject = z.object({
	id: prefixedId("prod"),
	object: z.literal("product"),
	livemode: z.boolean(),
	lookup_key: z.string().nullable(),
	name: z.string(),
	description: z.string(),
	photo_url: z.string().nullable(),
	price: Stars,
	currency: z.literal("XTR"),
	type: ProductType,
	/** Seconds; always 2592000 (30 days) for subscriptions. */
	period: z.int().nullable(),
	status: ProductStatus,
	metadata: Metadata,
	created_at: Timestamp,
});
export type ProductObject = z.infer<typeof ProductObject>;

export const OrderObject = z.object({
	id: prefixedId("ord"),
	object: z.literal("order"),
	livemode: z.boolean(),
	status: OrderStatus,
	failure_reason: z.string().nullable(),
	amount: Stars,
	currency: z.literal("XTR"),
	product: z.object({
		id: prefixedId("prod"),
		name: z.string(),
		type: ProductType,
	}),
	/** Only this Telegram user may pay, when set. */
	telegram_user_id: TelegramId.nullable(),
	customer: z
		.object({
			id: prefixedId("cus"),
			telegram_user_id: TelegramId,
			username: z.string().nullable(),
		})
		.nullable(),
	reference: z.string().nullable(),
	metadata: Metadata,
	invoice_link: z.string().nullable(),
	telegram_payment_charge_id: z.string().nullable(),
	subscription_id: prefixedId("sub").nullable(),
	expires_at: Timestamp,
	paid_at: Timestamp.nullable(),
	refunded_at: Timestamp.nullable(),
	created_at: Timestamp,
});
export type OrderObject = z.infer<typeof OrderObject>;

export const SubscriptionObject = z.object({
	id: prefixedId("sub"),
	object: z.literal("subscription"),
	livemode: z.boolean(),
	status: SubscriptionStatus,
	product: z.object({ id: prefixedId("prod"), name: z.string() }),
	customer: z.object({
		id: prefixedId("cus"),
		telegram_user_id: TelegramId,
		username: z.string().nullable(),
	}),
	price: Stars,
	current_period_end: Timestamp,
	cancelled_at: Timestamp.nullable(),
	created_at: Timestamp,
});
export type SubscriptionObject = z.infer<typeof SubscriptionObject>;

export const CustomerObject = z.object({
	id: prefixedId("cus"),
	object: z.literal("customer"),
	livemode: z.boolean(),
	telegram_user_id: TelegramId,
	username: z.string().nullable(),
	first_name: z.string().nullable(),
	last_name: z.string().nullable(),
	total_spent: Stars,
	order_count: z.int().nonnegative(),
	last_payment_at: Timestamp.nullable(),
	created_at: Timestamp,
});
export type CustomerObject = z.infer<typeof CustomerObject>;

export const BalanceObject = z.object({
	object: z.literal("balance"),
	livemode: z.boolean(),
	/** Null until the first sync with Telegram. */
	stars: Stars.nullable(),
	synced_at: Timestamp.nullable(),
});
export type BalanceObject = z.infer<typeof BalanceObject>;
