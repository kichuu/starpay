// Dashboard RPC, served under /rpc with session auth. The active organization
// comes from the session and the mode from the `x-starpay-mode` header.
import { oc } from "@orpc/contract";
import { z } from "zod";

import {
	ListInput,
	listOf,
	Mode,
	prefixedId,
	Stars,
	Timestamp,
} from "./common";
import {
	BalanceObject,
	CustomerObject,
	OrderObject,
	OrderStatus,
	ProductObject,
	SubscriptionObject,
	SubscriptionStatus,
} from "./objects";
import { adminContract, payoutsContract } from "./payouts";
import {
	CreateProductInput,
	ListProductsInput,
	UpdateProductInput,
} from "./public";

export const MODE_HEADER = "x-starpay-mode";

// ── Bot ──

export const BotStatus = z.enum([
	"active",
	"invalid_token",
	"webhook_error",
	"disconnected",
]);

export const BotView = z.object({
	id: prefixedId("bot"),
	mode: Mode,
	telegram_bot_id: z.number(),
	username: z.string(),
	first_name: z.string(),
	token_last4: z.string(),
	status: BotStatus,
	last_update_at: Timestamp.nullable(),
	last_update_type: z.string().nullable(),
	pending_updates: z.int(),
	last_webhook_error: z.string().nullable(),
	created_at: Timestamp,
});
export type BotView = z.infer<typeof BotView>;

// ── Orders ──

export const DashboardListOrdersInput = ListInput.extend({
	status: OrderStatus.optional(),
	/** Order ID, @username, Telegram user ID, charge ID or reference. */
	q: z.string().max(128).optional(),
});
export type DashboardListOrdersInput = z.infer<typeof DashboardListOrdersInput>;

export const OrderTimelineEntry = z.object({
	type: z.string(),
	data: z.record(z.string(), z.unknown()),
	created_at: Timestamp,
});

export const OrderDetail = z.object({
	order: OrderObject,
	timeline: z.array(OrderTimelineEntry),
	/** The raw successful_payment object from Telegram, when paid. */
	raw_payment: z.record(z.string(), z.unknown()).nullable(),
});
export type OrderDetail = z.infer<typeof OrderDetail>;

// ── API keys ──

export const ApiKeyView = z.object({
	id: prefixedId("key"),
	name: z.string(),
	mode: Mode,
	/** e.g. "live_sk_4f2a…8c21" */
	masked: z.string(),
	last_used_at: Timestamp.nullable(),
	revoked_at: Timestamp.nullable(),
	created_at: Timestamp,
});
export type ApiKeyView = z.infer<typeof ApiKeyView>;

// ── Settings ──

export const SettingsView = z.object({
	pay_support_text: z.string(),
	/** TON wallet for hosted-mode payouts. */
	payout_ton_address: z.string().max(80).nullable(),
	notify_payment: z.boolean(),
	notify_webhook_fail: z.boolean(),
	notify_sub_cancel: z.boolean(),
	notify_digest: z.boolean(),
	timezone: z.string(),
});
export type SettingsView = z.infer<typeof SettingsView>;

export const OnboardingStatus = z.object({
	bot_connected: z.boolean(),
	has_product: z.boolean(),
	has_paid_order: z.boolean(),
	has_api_key: z.boolean(),
});

// ── Overview ──

export const OverviewRange = z.enum(["today", "7d", "30d"]);
export type OverviewRange = z.infer<typeof OverviewRange>;

/** IANA time zone of the viewer, so "today" and chart buckets match their clock. */
const TimeZone = z
	.string()
	.max(64)
	.refine((tz) => {
		try {
			new Intl.DateTimeFormat("en", { timeZone: tz });
			return true;
		} catch {
			return false;
		}
	}, "Unknown time zone");

export const OverviewInput = z.object({
	range: OverviewRange,
	tz: TimeZone.default("UTC"),
});

export const OverviewResult = z.object({
	range: OverviewRange,
	/** Net of refunds. */
	revenue: z.object({ stars: Stars, previous: Stars }),
	payments: z.object({ count: z.int(), average: Stars }),
	/** Orders created in the range, and how many of them were paid. */
	conversion: z.object({ created: z.int(), paid: z.int() }),
	deliveries: z.object({ failed: z.int(), pending: z.int() }),
	/** Oldest first. `label` is an ISO date (7d/30d) or a start hour "00"–"20" (today). */
	series: z.array(z.object({ label: z.string(), stars: Stars })),
	recent: z.array(OrderObject),
});
export type OverviewResult = z.infer<typeof OverviewResult>;

// ── Customers, subscriptions, balance ──

export const ListCustomersInput = z.object({
	/** @username or Telegram user ID. */
	q: z.string().max(64).optional(),
	limit: z.int().min(1).max(100).default(25),
	offset: z.int().min(0).default(0),
});

export const SubscriptionStats = z.object({
	active: z.int(),
	/** Cancelled but still inside the paid period. */
	cancelled: z.int(),
	/** Stars per 30 days if every active subscription renews. */
	monthly_stars: Stars,
});

export const StarTransactionView = z.object({
	id: z.string(),
	date: Timestamp,
	/** Signed: positive = received. */
	amount: z.int(),
	kind: z.enum(["payment", "refund", "withdrawal", "other"]),
	label: z.string(),
	order_id: z.string().nullable(),
});
export type StarTransactionView = z.infer<typeof StarTransactionView>;

const Ok = z.object({ ok: z.literal(true) });

export const dashboardContract = {
	onboarding: {
		status: oc.output(OnboardingStatus),
	},
	overview: {
		get: oc.input(OverviewInput).output(OverviewResult),
	},
	customers: {
		list: oc
			.input(ListCustomersInput)
			.output(z.object({ data: z.array(CustomerObject), total: z.int() })),
	},
	subscriptions: {
		stats: oc.output(SubscriptionStats),
		list: oc
			.input(ListInput.extend({ status: SubscriptionStatus.optional() }))
			.output(listOf(SubscriptionObject)),
	},
	balance: {
		/** Cached balance, refreshed from Telegram when older than a minute. */
		get: oc.output(BalanceObject),
		/** Live from Telegram's getStarTransactions, newest first. */
		transactions: oc
			.input(z.object({ offset: z.int().min(0).default(0) }))
			.output(
				z.object({
					data: z.array(StarTransactionView),
					next_offset: z.int().nullable(),
				}),
			),
	},
	bot: {
		get: oc.output(BotView.nullable()),
		connect: oc
			.input(
				z.object({
					token: z.string().regex(/^\d+:[\w-]{30,}$/, "Not a bot token"),
				}),
			)
			.output(BotView),
		/** Re-run getWebhookInfo and re-register the webhook if needed. */
		refresh: oc.output(BotView),
		disconnect: oc.output(Ok),
	},
	products: {
		list: oc.input(ListProductsInput).output(listOf(ProductObject)),
		create: oc.input(CreateProductInput).output(ProductObject),
		update: oc.input(UpdateProductInput).output(ProductObject),
	},
	orders: {
		list: oc.input(DashboardListOrdersInput).output(listOf(OrderObject)),
		get: oc.input(z.object({ id: prefixedId("ord") })).output(OrderDetail),
		refund: oc.input(z.object({ id: prefixedId("ord") })).output(OrderObject),
		cancel: oc.input(z.object({ id: prefixedId("ord") })).output(OrderObject),
	},
	apiKeys: {
		list: oc.output(z.array(ApiKeyView)),
		/** The full secret is returned once and never again. */
		create: oc
			.input(z.object({ name: z.string().min(1).max(64) }))
			.output(ApiKeyView.extend({ secret: z.string() })),
		revoke: oc.input(z.object({ id: prefixedId("key") })).output(Ok),
	},
	payouts: payoutsContract,
	/** StarPay staff only (PLATFORM_ADMIN_USER_IDS). */
	admin: adminContract,
	/** The signed-in user's platform permissions (for showing the admin link). */
	me: oc.output(z.object({ user_id: z.string(), platform_admin: z.boolean() })),
	settings: {
		get: oc.output(SettingsView),
		update: oc.input(SettingsView.partial()).output(SettingsView),
	},
};
export type DashboardContract = typeof dashboardContract;
