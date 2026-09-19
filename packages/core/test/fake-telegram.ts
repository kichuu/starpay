import { TelegramApiError, TelegramClient } from "@starpay/telegram";

type Handler = (params: Record<string, unknown>) => unknown;

/** Records every Bot API call and answers from a per-method handler table. */
export class FakeTelegram extends TelegramClient {
	readonly calls: { method: string; params: Record<string, unknown> }[] = [];
	/** Unique per instance: one Telegram bot can only belong to one merchant. */
	readonly botId = 7_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
	readonly handlers: Record<string, Handler> = {
		getMe: () => ({
			id: this.botId,
			is_bot: true,
			first_name: "Pixel Forge Shop",
			username: "pixelforge_bot",
		}),
		setWebhook: () => true,
		setMyCommands: () => true,
		deleteWebhook: () => true,
		createInvoiceLink: (params) => `https://t.me/$fake_${params.payload}`,
		sendInvoice: () => ({
			message_id: 1,
			date: 0,
			chat: { id: 1, type: "private" },
		}),
		refundStarPayment: () => true,
	};

	constructor() {
		super({ token: "0:fake" });
	}

	override async call<T>(method: string, params: object = {}): Promise<T> {
		this.calls.push({ method, params: params as Record<string, unknown> });
		const handler = this.handlers[method];
		if (!handler)
			throw new TelegramApiError(
				method,
				400,
				`FakeTelegram: no handler for ${method}`,
			);
		return handler(params as Record<string, unknown>) as T;
	}

	callsTo(method: string) {
		return this.calls.filter((call) => call.method === method);
	}
}
