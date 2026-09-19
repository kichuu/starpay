// Prisma rows → contract objects. The only place that knows about BigInt → number,
// snake_case and which internal fields stay hidden.
import type {
	ApiKeyView,
	BotView,
	CustomerObject,
	OrderObject,
	ProductObject,
	SettingsView,
} from "@starpay/contracts";
import type {
	ApiKey,
	Bot,
	Customer,
	MerchantSettings,
	Prisma,
	Product,
} from "@starpay/db";

const iso = (date: Date) => date.toISOString();
const isoOrNull = (date: Date | null) => (date ? date.toISOString() : null);
const asMetadata = (value: Prisma.JsonValue) =>
	(value && typeof value === "object" && !Array.isArray(value)
		? value
		: {}) as Record<string, string>;

export function serializeProduct(product: Product): ProductObject {
	return {
		id: product.id,
		object: "product",
		livemode: product.mode === "live",
		lookup_key: product.lookupKey,
		name: product.name,
		description: product.description,
		photo_url: product.photoUrl,
		price: product.priceStars,
		currency: "XTR",
		type: product.type,
		period: product.periodSeconds,
		status: product.status,
		metadata: asMetadata(product.metadata),
		created_at: iso(product.createdAt),
	};
}

/** Relations every order query must load for serializeOrder. */
export const orderInclude = {
	product: { select: { id: true, name: true, type: true } },
	customer: { select: { id: true, telegramUserId: true, username: true } },
	payments: {
		select: { telegramChargeId: true },
		orderBy: { createdAt: "asc" },
		take: 1,
	},
	subscription: { select: { id: true } },
} satisfies Prisma.OrderInclude;

export type OrderWithRelations = Prisma.OrderGetPayload<{
	include: typeof orderInclude;
}>;

export function serializeOrder(order: OrderWithRelations): OrderObject {
	return {
		id: order.id,
		object: "order",
		livemode: order.mode === "live",
		status: order.status,
		failure_reason: order.failureReason,
		amount: order.amountStars,
		currency: "XTR",
		product: order.product,
		telegram_user_id:
			order.payerTelegramId === null ? null : Number(order.payerTelegramId),
		customer: order.customer
			? {
					id: order.customer.id,
					telegram_user_id: Number(order.customer.telegramUserId),
					username: order.customer.username,
				}
			: null,
		reference: order.merchantReference,
		metadata: asMetadata(order.metadata),
		invoice_link: order.invoiceLink,
		telegram_payment_charge_id: order.payments[0]?.telegramChargeId ?? null,
		subscription_id: order.subscription?.id ?? null,
		expires_at: iso(order.expiresAt),
		paid_at: isoOrNull(order.paidAt),
		refunded_at: isoOrNull(order.refundedAt),
		created_at: iso(order.createdAt),
	};
}

export function serializeCustomer(customer: Customer): CustomerObject {
	return {
		id: customer.id,
		object: "customer",
		livemode: customer.mode === "live",
		telegram_user_id: Number(customer.telegramUserId),
		username: customer.username,
		first_name: customer.firstName,
		last_name: customer.lastName,
		total_spent: customer.totalSpent,
		order_count: customer.orderCount,
		last_payment_at: isoOrNull(customer.lastPaymentAt),
		created_at: iso(customer.createdAt),
	};
}

export function serializeBot(bot: Bot): BotView {
	return {
		id: bot.id,
		mode: bot.mode,
		telegram_bot_id: Number(bot.telegramBotId),
		username: bot.username,
		first_name: bot.firstName,
		token_last4: bot.tokenLast4,
		status: bot.status,
		last_update_at: isoOrNull(bot.lastUpdateAt),
		last_update_type: bot.lastUpdateType,
		pending_updates: bot.pendingUpdates,
		last_webhook_error: bot.lastWebhookError,
		created_at: iso(bot.createdAt),
	};
}

export function serializeApiKey(key: ApiKey): ApiKeyView {
	return {
		id: key.id,
		name: key.name,
		mode: key.mode,
		masked: `${key.prefix}…${key.last4}`,
		last_used_at: isoOrNull(key.lastUsedAt),
		revoked_at: isoOrNull(key.revokedAt),
		created_at: iso(key.createdAt),
	};
}

export function serializeSettings(settings: MerchantSettings): SettingsView {
	return {
		pay_support_text: settings.paySupportText,
		notify_payment: settings.notifyPayment,
		notify_webhook_fail: settings.notifyWebhookFail,
		notify_sub_cancel: settings.notifySubCancel,
		notify_digest: settings.notifyDigest,
		timezone: settings.timezone,
	};
}

export const toJson = (value: unknown) =>
	JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
