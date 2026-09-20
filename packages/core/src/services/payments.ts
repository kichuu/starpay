import type { Bot, Payment, Tx } from "@starpay/db";
import { Prisma } from "@starpay/db";
import {
	type PreCheckoutQuery,
	type RefundedPayment,
	type SuccessfulPayment,
	TelegramApiError,
	type User,
} from "@starpay/telegram";

import type { Actor, Deps, Scope } from "../deps";
import { errors } from "../errors";
import { newId } from "../ids";
import { planFor } from "../ledger/fees";
import { orderInclude, serializeOrder, toJson } from "../serializers";
import { audit } from "./audit";
import type { BotService } from "./bots";
import { addOrderEvent, emitEvent } from "./events";
import { OPEN_STATUSES } from "./orders";
import { bookPayment, bookRefund, termsFor } from "./settlement";

export type PreCheckoutDecision =
	| { ok: true }
	| { ok: false; error_message: string };

const REJECT = {
	notFound: "This invoice is no longer available.",
	expired: "This invoice has expired. Please request a new one.",
	alreadyPaid: "This invoice has already been paid.",
	wrongPayer: "This invoice was issued to a different Telegram account.",
	mismatch: "This invoice is invalid. Please request a new one.",
	unavailable: "This item is no longer available.",
} as const;

const scopeOf = (owner: {
	organizationId: string;
	mode: Scope["mode"];
}): Scope => ({
	organizationId: owner.organizationId,
	mode: owner.mode,
});

export function createPaymentService(deps: Deps, bots: BotService) {
	const { db } = deps;

	/** The order behind an invoice payload, only if this bot issued it. */
	async function findOrderForBot(bot: Bot, orderId: string) {
		return db.order.findFirst({
			where: { id: orderId, botId: bot.id, mode: bot.mode },
			include: { product: { select: { status: true } } },
		});
	}

	/** Marks a payment refunded and emits payment.refunded. Returns false if it already was. */
	async function applyRefund(
		tx: Tx,
		scope: Scope,
		payment: Payment,
		now: Date,
		source: string,
	) {
		const { count } = await tx.payment.updateMany({
			where: { id: payment.id, refundedAt: null },
			data: { refundedAt: now },
		});
		if (count === 0) return false;

		if (payment.settlement === "platform") {
			// Re-read under the row lock taken above: releasedAt decides which balance is debited.
			const locked = await tx.payment.findUniqueOrThrow({
				where: { id: payment.id },
			});
			await bookRefund(tx, locked, now);
		}

		await tx.order.updateMany({
			where: { id: payment.orderId, status: "paid" },
			data: { status: "refunded", refundedAt: now },
		});
		const order = await tx.order.findUniqueOrThrow({
			where: { id: payment.orderId },
			include: orderInclude,
		});
		if (order.customerId) {
			await tx.customer.update({
				where: { id: order.customerId },
				data: { totalSpent: { decrement: payment.amountStars } },
			});
		}
		await addOrderEvent(tx, order.id, "refunded", now, {
			source,
			amount: payment.amountStars,
		});
		await emitEvent(tx, scope, "payment.refunded", serializeOrder(order), now);
		return true;
	}

	return {
		/**
		 * Decides a pre_checkout_query. Must stay fast: Telegram cancels the
		 * payment if we don't answer within 10 seconds. DB only, no network.
		 */
		async handlePreCheckout(
			bot: Bot,
			query: PreCheckoutQuery,
		): Promise<PreCheckoutDecision> {
			const now = deps.now();
			const order = await findOrderForBot(bot, query.invoice_payload);
			if (!order) return { ok: false, error_message: REJECT.notFound };

			const reject = async (
				reason: keyof typeof REJECT,
				data: Record<string, unknown> = {},
			) => {
				await addOrderEvent(db, order.id, "pre_checkout_rejected", now, {
					reason,
					from: query.from.id,
					...data,
				});
				return { ok: false as const, error_message: REJECT[reason] };
			};

			if (order.status === "paid" || order.status === "refunded")
				return reject("alreadyPaid");
			if (!OPEN_STATUSES.includes(order.status))
				return reject("expired", { status: order.status });
			if (order.expiresAt <= now) {
				// The expiry job would get here too; do it now so the merchant hears sooner.
				await db.$transaction(async (tx) => {
					const { count } = await tx.order.updateMany({
						where: { id: order.id, status: { in: OPEN_STATUSES } },
						data: { status: "expired", failureReason: "expired" },
					});
					if (count === 0) return;
					await addOrderEvent(tx, order.id, "expired", now);
					const full = await tx.order.findUniqueOrThrow({
						where: { id: order.id },
						include: orderInclude,
					});
					await emitEvent(
						tx,
						scopeOf(order),
						"order.expired",
						serializeOrder(full),
						now,
					);
				});
				return reject("expired");
			}
			if (
				order.payerTelegramId !== null &&
				order.payerTelegramId !== BigInt(query.from.id)
			) {
				// Someone else opened a link meant for another user. The order stays open.
				return reject("wrongPayer");
			}
			if (
				query.currency !== "XTR" ||
				query.total_amount !== order.amountStars
			) {
				return reject("mismatch", {
					currency: query.currency,
					total_amount: query.total_amount,
				});
			}
			if (order.product.status !== "active") {
				await db.$transaction(async (tx) => {
					await tx.order.update({
						where: { id: order.id },
						data: { status: "failed", failureReason: "product_archived" },
					});
					const full = await tx.order.findUniqueOrThrow({
						where: { id: order.id },
						include: orderInclude,
					});
					await emitEvent(
						tx,
						scopeOf(order),
						"payment.failed",
						serializeOrder(full),
						now,
					);
				});
				return reject("unavailable");
			}

			await db.order.updateMany({
				where: { id: order.id, status: { in: OPEN_STATUSES } },
				data: { status: "pre_checkout" },
			});
			await addOrderEvent(db, order.id, "pre_checkout_approved", now, {
				from: query.from.id,
			});
			return { ok: true };
		},

		/**
		 * Records a successful_payment exactly once (unique charge ID). Never
		 * drops a payment: late payments on expired orders still mark them paid.
		 */
		async handleSuccessfulPayment(
			bot: Bot,
			payment: SuccessfulPayment,
			from: User | undefined,
		) {
			const now = deps.now();
			const order = await findOrderForBot(bot, payment.invoice_payload);
			if (!order) {
				await audit(
					db,
					scopeOf(bot),
					{ type: "system", id: "system" },
					"payment.orphaned",
					payment.telegram_payment_charge_id,
					{
						payment,
					},
				);
				return { recorded: false as const, reason: "order_not_found" };
			}

			const scope = scopeOf(order);
			const payerId = BigInt(from?.id ?? order.payerTelegramId ?? 0);
			const isRenewal = Boolean(
				payment.is_recurring && !payment.is_first_recurring,
			);
			const periodEnd = payment.subscription_expiration_date
				? new Date(payment.subscription_expiration_date * 1000)
				: null;

			try {
				await db.$transaction(async (tx) => {
					const customer = await tx.customer.upsert({
						where: {
							organizationId_mode_telegramUserId: {
								organizationId: scope.organizationId,
								mode: scope.mode,
								telegramUserId: payerId,
							},
						},
						create: {
							id: newId("customer", now.getTime()),
							organizationId: scope.organizationId,
							mode: scope.mode,
							telegramUserId: payerId,
							username: from?.username,
							firstName: from?.first_name,
							lastName: from?.last_name,
							languageCode: from?.language_code,
							totalSpent: payment.total_amount,
							orderCount: 1,
							lastPaymentAt: now,
						},
						update: {
							username: from?.username,
							firstName: from?.first_name,
							lastName: from?.last_name,
							totalSpent: { increment: payment.total_amount },
							orderCount: isRenewal ? undefined : { increment: 1 },
							lastPaymentAt: now,
						},
					});

					const subscription = isRenewal
						? await tx.subscription.findUnique({ where: { orderId: order.id } })
						: null;

					// Hosted: StarPay's fee is fixed at payment time from the merchant's plan.
					const terms =
						order.settlement === "platform"
							? termsFor(
									payment.total_amount,
									await planFor(tx, order.organizationId),
									now,
								)
							: null;

					// Unique on telegramChargeId: a redelivered update fails here and rolls back.
					const created = await tx.payment.create({
						data: {
							settlement: order.settlement,
							feeStars: terms?.feeStars ?? 0,
							netStars: terms?.netStars,
							feePlanId: terms?.feePlanId,
							availableAt: terms?.availableAt,
							id: newId("payment", now.getTime()),
							organizationId: scope.organizationId,
							mode: scope.mode,
							orderId: order.id,
							subscriptionId: subscription?.id,
							telegramChargeId: payment.telegram_payment_charge_id,
							amountStars: payment.total_amount,
							isRecurring: Boolean(payment.is_recurring),
							isFirstRecurring: Boolean(payment.is_first_recurring),
							subscriptionExpiresAt: periodEnd,
							raw: toJson(payment),
							createdAt: now,
						},
					});
					if (created.settlement === "platform")
						await bookPayment(tx, created, now);

					if (isRenewal && subscription && periodEnd) {
						await tx.subscription.update({
							where: { id: subscription.id },
							data: { status: "active", currentPeriodEnd: periodEnd },
						});
						await addOrderEvent(tx, order.id, "subscription_renewed", now, {
							amount: payment.total_amount,
							period_end: periodEnd.toISOString(),
						});
						const full = await tx.order.findUniqueOrThrow({
							where: { id: order.id },
							include: orderInclude,
						});
						await emitEvent(
							tx,
							scope,
							"subscription.renewed",
							serializeOrder(full),
							now,
						);
						return;
					}

					const late = order.status === "expired" || order.status === "failed";
					await tx.order.update({
						where: { id: order.id },
						data: {
							status: "paid",
							paidAt: now,
							customerId: customer.id,
							failureReason: null,
						},
					});
					if (periodEnd) {
						await tx.subscription.create({
							data: {
								id: newId("subscription", now.getTime()),
								organizationId: scope.organizationId,
								mode: scope.mode,
								productId: order.productId,
								customerId: customer.id,
								orderId: order.id,
								firstChargeId: payment.telegram_payment_charge_id,
								currentPeriodEnd: periodEnd,
							},
						});
					}
					await addOrderEvent(tx, order.id, "paid", now, {
						amount: payment.total_amount,
						charge_id: payment.telegram_payment_charge_id,
						...(late
							? { late_payment: true, previous_status: order.status }
							: {}),
					});
					const full = await tx.order.findUniqueOrThrow({
						where: { id: order.id },
						include: orderInclude,
					});
					await emitEvent(
						tx,
						scope,
						"payment.succeeded",
						serializeOrder(full),
						now,
					);
				});
			} catch (error) {
				if (
					error instanceof Prisma.PrismaClientKnownRequestError &&
					error.code === "P2002"
				) {
					return { recorded: false as const, reason: "duplicate" };
				}
				throw error;
			}
			return { recorded: true as const };
		},

		/** Refund requested through the API or dashboard. */
		async refund(scope: Scope, orderId: string, actor: Actor) {
			const order = await db.order.findFirst({
				where: {
					id: orderId,
					organizationId: scope.organizationId,
					mode: scope.mode,
				},
				include: { customer: true },
			});
			if (!order) throw errors.orderNotFound(orderId);
			if (order.status !== "paid" || !order.customer) {
				throw errors.orderNotRefundable(orderId, order.status);
			}
			// Subscriptions: refund the latest charge.
			const payment = await db.payment.findFirst({
				where: { orderId, refundedAt: null },
				orderBy: { createdAt: "desc" },
			});
			if (!payment) throw errors.orderNotRefundable(orderId, order.status);

			// Refund through whichever bot took the payment (the merchant's or StarPay's).
			const bot = order.botId
				? await bots.byId(order.botId)
				: await bots.requireActive(scope);
			try {
				await bots.clientFor(bot).refundStarPayment({
					user_id: Number(order.customer.telegramUserId),
					telegram_payment_charge_id: payment.telegramChargeId,
				});
			} catch (error) {
				// Already refunded elsewhere (e.g. from Telegram): record it and carry on.
				const alreadyRefunded =
					error instanceof TelegramApiError &&
					error.description.includes("CHARGE_ALREADY_REFUNDED");
				if (!alreadyRefunded) {
					throw errors.telegram(
						error instanceof TelegramApiError
							? error.description
							: String(error),
					);
				}
			}

			const now = deps.now();
			await db.$transaction(async (tx) => {
				await applyRefund(tx, scope, payment, now, actor.type);
				await audit(tx, scope, actor, "order.refund", orderId, {
					amount: payment.amountStars,
				});
			});
			return serializeOrder(
				await db.order.findUniqueOrThrow({
					where: { id: orderId },
					include: orderInclude,
				}),
			);
		},

		/** Telegram told us about a refund we didn't initiate. */
		async handleExternalRefund(bot: Bot, refunded: RefundedPayment) {
			const payment = await db.payment.findUnique({
				where: { telegramChargeId: refunded.telegram_payment_charge_id },
				include: { order: { select: { botId: true } } },
			});
			if (!payment || payment.order.botId !== bot.id) {
				return { applied: false };
			}
			const applied = await db.$transaction((tx) =>
				applyRefund(tx, scopeOf(payment), payment, deps.now(), "telegram"),
			);
			return { applied };
		},
	};
}

export type PaymentService = ReturnType<typeof createPaymentService>;
