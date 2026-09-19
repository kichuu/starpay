import type { AnswerPreCheckoutQueryParams, SendMessageParams } from "./types";

export * from "./client";
export type * from "./types";

/**
 * A method call returned as the body of a webhook response. Telegram executes
 * it without a separate API request, but its result is not reported back.
 * https://core.telegram.org/bots/api#making-requests-when-getting-updates
 */
export type WebhookReply =
	| ({ method: "answerPreCheckoutQuery" } & AnswerPreCheckoutQueryParams)
	| ({ method: "sendMessage" } & SendMessageParams);

export const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";

/** Telegram allows exactly 30 days for Star subscriptions. */
export const STAR_SUBSCRIPTION_PERIOD = 2_592_000;
