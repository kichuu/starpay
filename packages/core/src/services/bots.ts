import type { Bot } from "@starpay/db";
import { TelegramApiError } from "@starpay/telegram";

import { randomBase58 } from "../crypto";
import type { Actor, Deps, Scope } from "../deps";
import { DomainError, errors } from "../errors";
import { newId } from "../ids";
import { serializeBot } from "../serializers";
import { audit } from "./audit";

export const BOT_COMMANDS = [
	{ command: "paysupport", description: "Help with a payment" },
];
const ALLOWED_UPDATES = ["message", "pre_checkout_query"] as const;

/** Telegram keeps last_error_date forever; only a recent error means the webhook is failing now. */
const WEBHOOK_ERROR_WINDOW_MS = 15 * 60 * 1000;

export function createBotService(deps: Deps) {
	const { db, box } = deps;

	function webhookUrl(botId: string) {
		return `${deps.config.publicApiUrl.replace(/\/$/, "")}/telegram/webhook/${botId}`;
	}

	/** Bot API client for a stored bot. */
	function clientFor(bot: Bot) {
		return deps.telegram(box.decrypt(bot.tokenEncrypted), bot.mode);
	}

	async function find(scope: Scope) {
		return db.bot.findUnique({
			where: {
				organizationId_mode: {
					organizationId: scope.organizationId,
					mode: scope.mode,
				},
			},
		});
	}

	/** The connected bot, or BOT_NOT_CONNECTED. */
	async function requireActive(scope: Scope) {
		const bot = await find(scope);
		if (
			!bot ||
			bot.status === "disconnected" ||
			bot.status === "invalid_token"
		) {
			throw errors.botNotConnected();
		}
		return bot;
	}

	/** Points Telegram at our webhook. Failures are recorded on the bot, not thrown. */
	async function registerWebhook(bot: Bot): Promise<Bot> {
		const telegram = clientFor(bot);
		try {
			await telegram.setWebhook({
				url: webhookUrl(bot.id),
				secret_token: bot.webhookSecret,
				allowed_updates: [...ALLOWED_UPDATES],
			});
			await telegram.setMyCommands(BOT_COMMANDS).catch(() => undefined);
			return db.bot.update({
				where: { id: bot.id },
				data: { status: "active", lastWebhookError: null },
			});
		} catch (error) {
			return db.bot.update({
				where: { id: bot.id },
				data: {
					status:
						error instanceof TelegramApiError && error.isUnauthorized
							? "invalid_token"
							: "webhook_error",
					lastWebhookError:
						error instanceof Error ? error.message : String(error),
				},
			});
		}
	}

	return {
		find,
		requireActive,
		clientFor,

		async get(scope: Scope) {
			const bot = await find(scope);
			return bot && bot.status !== "disconnected" ? serializeBot(bot) : null;
		},

		async connect(scope: Scope, token: string, actor: Actor) {
			const telegram = deps.telegram(token, scope.mode);
			let me: Awaited<ReturnType<typeof telegram.getMe>>;
			try {
				me = await telegram.getMe();
			} catch (error) {
				if (error instanceof TelegramApiError && error.isUnauthorized)
					throw errors.botTokenInvalid();
				throw errors.telegram(
					error instanceof Error ? error.message : String(error),
				);
			}

			const telegramBotId = BigInt(me.id);
			const claimed = await db.bot.findUnique({
				where: { telegramBotId_mode: { telegramBotId, mode: scope.mode } },
			});
			if (
				claimed &&
				claimed.organizationId !== scope.organizationId &&
				claimed.status !== "disconnected"
			) {
				throw new DomainError(
					"CONFLICT",
					409,
					`@${me.username} is already connected to another merchant`,
				);
			}

			const existing = await find(scope);
			if (existing && existing.telegramBotId !== telegramBotId) {
				// Switching bots: stop the old one from sending us updates.
				await clientFor(existing)
					.deleteWebhook()
					.catch(() => undefined);
			}
			if (claimed && claimed.organizationId !== scope.organizationId) {
				await db.bot.delete({ where: { id: claimed.id } });
			}

			const fields = {
				telegramBotId,
				username: me.username ?? String(me.id),
				firstName: me.first_name,
				tokenEncrypted: box.encrypt(token),
				tokenLast4: token.slice(-4),
				webhookSecret: randomBase58(48),
				status: "active" as const,
				lastWebhookError: null,
			};
			const bot = await db.bot.upsert({
				where: {
					organizationId_mode: {
						organizationId: scope.organizationId,
						mode: scope.mode,
					},
				},
				create: {
					id: newId("bot"),
					organizationId: scope.organizationId,
					mode: scope.mode,
					...fields,
				},
				update: fields,
			});

			const registered = await registerWebhook(bot);
			await audit(db, scope, actor, "bot.connect", bot.id, {
				username: bot.username,
			});
			return serializeBot(registered);
		},

		async refresh(scope: Scope) {
			let bot = await find(scope);
			if (!bot || bot.status === "disconnected") throw errors.botNotConnected();

			try {
				const info = await clientFor(bot).getWebhookInfo();
				if (info.url !== webhookUrl(bot.id)) {
					bot = await registerWebhook(bot);
					if (bot.status !== "active") return serializeBot(bot);
				}
				const recentError =
					info.last_error_date !== undefined &&
					deps.now().getTime() - info.last_error_date * 1000 <
						WEBHOOK_ERROR_WINDOW_MS;
				bot = await db.bot.update({
					where: { id: bot.id },
					data: {
						pendingUpdates: info.pending_update_count,
						status: recentError ? "webhook_error" : "active",
						lastWebhookError: recentError
							? (info.last_error_message ?? null)
							: null,
					},
				});
			} catch (error) {
				bot = await db.bot.update({
					where: { id: bot.id },
					data: {
						status:
							error instanceof TelegramApiError && error.isUnauthorized
								? "invalid_token"
								: "webhook_error",
						lastWebhookError:
							error instanceof Error ? error.message : String(error),
					},
				});
			}
			return serializeBot(bot);
		},

		async disconnect(scope: Scope, actor: Actor) {
			const bot = await find(scope);
			if (!bot) return { ok: true as const };
			await clientFor(bot)
				.deleteWebhook()
				.catch(() => undefined);
			await db.bot.update({
				where: { id: bot.id },
				data: { status: "disconnected" },
			});
			await audit(db, scope, actor, "bot.disconnect", bot.id);
			return { ok: true as const };
		},
	};
}

export type BotService = ReturnType<typeof createBotService>;
