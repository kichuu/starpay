import { Prisma } from "@starpay/db";
import type { Update, WebhookReply } from "@starpay/telegram";

import { safeEqual } from "../crypto";
import type { Deps } from "../deps";
import { toJson } from "../serializers";
import type { PaymentService } from "./payments";

export type TelegramWebhookResult =
	| { status: 401 | 404 }
	| { status: 200; reply?: WebhookReply };

const DEFAULT_SUPPORT_TEXT =
	"Need help with a payment? Reply to this chat and the seller will get back to you.";

function classify(update: Update): string {
	if (update.pre_checkout_query) return "pre_checkout_query";
	if (update.message?.successful_payment) return "successful_payment";
	if (update.message?.refunded_payment) return "refunded_payment";
	if (update.message) return "message";
	return "other";
}

export function createTelegramUpdateService(
	deps: Deps,
	payments: PaymentService,
) {
	const { db } = deps;

	return {
		/**
		 * Entry point for POST /telegram/webhook/:botId. Returns 200 for anything
		 * that passed authentication: a non-2xx makes Telegram retry and stalls
		 * the bot's whole update queue.
		 */
		async handle(
			botId: string,
			secretHeader: string | undefined,
			update: Update,
		): Promise<TelegramWebhookResult> {
			const bot = await db.bot.findUnique({ where: { id: botId } });
			if (!bot || bot.status === "disconnected") return { status: 404 };
			if (!secretHeader || !safeEqual(secretHeader, bot.webhookSecret))
				return { status: 401 };

			const started = Date.now();
			const type = classify(update);
			let inbox: { id: string };
			try {
				inbox = await db.telegramUpdate.create({
					data: {
						botId,
						updateId: BigInt(update.update_id),
						type,
						payload: toJson(update),
					},
					select: { id: true },
				});
			} catch (error) {
				if (
					error instanceof Prisma.PrismaClientKnownRequestError &&
					error.code === "P2002"
				) {
					return { status: 200 }; // redelivery
				}
				throw error;
			}

			let reply: WebhookReply | undefined;
			let failure: string | undefined;
			try {
				if (update.pre_checkout_query) {
					const query = update.pre_checkout_query;
					const decision = await payments.handlePreCheckout(bot, query);
					reply = {
						method: "answerPreCheckoutQuery",
						pre_checkout_query_id: query.id,
						...decision,
					};
				} else if (update.message?.successful_payment) {
					await payments.handleSuccessfulPayment(
						bot,
						update.message.successful_payment,
						update.message.from,
					);
				} else if (update.message?.refunded_payment) {
					await payments.handleExternalRefund(
						bot,
						update.message.refunded_payment,
					);
				} else if (update.message?.text?.startsWith("/paysupport")) {
					const settings = await db.merchantSettings.findUnique({
						where: { organizationId: bot.organizationId },
					});
					reply = {
						method: "sendMessage",
						chat_id: update.message.chat.id,
						text: settings?.paySupportText || DEFAULT_SUPPORT_TEXT,
					};
				}
			} catch (error) {
				failure =
					error instanceof Error
						? `${error.name}: ${error.message}`
						: String(error);
				console.error(
					`[telegram] update ${update.update_id} for ${botId} failed`,
					error,
				);
				if (update.pre_checkout_query) {
					// Don't leave the buyer on a spinner; Telegram would time out anyway.
					reply = {
						method: "answerPreCheckoutQuery",
						pre_checkout_query_id: update.pre_checkout_query.id,
						ok: false,
						error_message:
							"Payment is temporarily unavailable. Please try again.",
					};
				}
			}

			const now = deps.now();
			await Promise.all([
				db.telegramUpdate.update({
					where: { id: inbox.id },
					data: {
						processedAt: now,
						processingMs: Date.now() - started,
						error: failure,
					},
				}),
				db.bot.update({
					where: { id: botId },
					data: { lastUpdateAt: now, lastUpdateType: type },
				}),
			]);
			return { status: 200, reply };
		},
	};
}

export type TelegramUpdateService = ReturnType<
	typeof createTelegramUpdateService
>;
