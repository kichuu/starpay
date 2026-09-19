import type { Update } from "@starpay/telegram";
import { TELEGRAM_SECRET_HEADER } from "@starpay/telegram";
import { Hono } from "hono";

import { services } from "../services";

/**
 * Telegram bot updates. Plain Hono (not oRPC): the response body may carry a
 * Bot API method call (answerPreCheckoutQuery), which saves a round trip
 * inside Telegram's 10-second pre-checkout deadline.
 */
export const telegramRoutes = new Hono().post("/webhook/:botId", async (c) => {
	const update = await c.req.json<Update>().catch(() => null);
	if (!update || typeof update.update_id !== "number") {
		return c.body(null, 400);
	}

	const result = await services.telegramUpdates.handle(
		c.req.param("botId"),
		c.req.header(TELEGRAM_SECRET_HEADER),
		update,
	);
	if (result.status !== 200) return c.body(null, result.status);
	return result.reply ? c.json(result.reply) : c.body(null, 200);
});
