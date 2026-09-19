import type {
	AnswerPreCheckoutQueryParams,
	BotCommand,
	CreateInvoiceLinkParams,
	Message,
	SendInvoiceParams,
	SendMessageParams,
	SetWebhookParams,
	StarAmount,
	StarTransactions,
	User,
	WebhookInfo,
} from "./types";

export type TelegramEnvironment = "production" | "test";

export type TelegramClientOptions = {
	token: string;
	/** "test" targets Telegram's test server: /bot<token>/test/<method>. */
	environment?: TelegramEnvironment;
	apiBaseUrl?: string;
	timeoutMs?: number;
	fetch?: typeof fetch;
};

export class TelegramApiError extends Error {
	constructor(
		readonly method: string,
		readonly errorCode: number,
		readonly description: string,
		readonly retryAfter?: number,
	) {
		super(`Telegram ${method} failed (${errorCode}): ${description}`);
		this.name = "TelegramApiError";
	}

	/** 401 = revoked or wrong token. */
	get isUnauthorized() {
		return this.errorCode === 401;
	}
}

type ApiResponse<T> =
	| { ok: true; result: T }
	| {
			ok: false;
			error_code: number;
			description: string;
			parameters?: { retry_after?: number };
	  };

export class TelegramClient {
	private readonly token: string;
	private readonly environment: TelegramEnvironment;
	private readonly apiBaseUrl: string;
	private readonly timeoutMs: number;
	private readonly fetchImpl: typeof fetch;

	constructor(options: TelegramClientOptions) {
		this.token = options.token;
		this.environment = options.environment ?? "production";
		this.apiBaseUrl = options.apiBaseUrl ?? "https://api.telegram.org";
		this.timeoutMs = options.timeoutMs ?? 10_000;
		this.fetchImpl = options.fetch ?? fetch;
	}

	async call<T>(method: string, params: object = {}): Promise<T> {
		const envSegment = this.environment === "test" ? "/test" : "";
		const url = `${this.apiBaseUrl}/bot${this.token}${envSegment}/${method}`;

		let response: Response;
		try {
			response = await this.fetchImpl(url, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(params),
				signal: AbortSignal.timeout(this.timeoutMs),
			});
		} catch (error) {
			// The URL contains the bot token; never let it reach logs.
			throw new TelegramApiError(method, 0, this.redact(String(error)));
		}

		const body = (await response
			.json()
			.catch(() => null)) as ApiResponse<T> | null;
		if (!body) {
			throw new TelegramApiError(
				method,
				response.status,
				"Invalid response body",
			);
		}
		if (!body.ok) {
			throw new TelegramApiError(
				method,
				body.error_code,
				this.redact(body.description),
				body.parameters?.retry_after,
			);
		}
		return body.result;
	}

	private redact(text: string) {
		return text.split(this.token).join("<token>");
	}

	getMe() {
		return this.call<User>("getMe");
	}

	setWebhook(params: SetWebhookParams) {
		return this.call<true>("setWebhook", params);
	}

	deleteWebhook(params: { drop_pending_updates?: boolean } = {}) {
		return this.call<true>("deleteWebhook", params);
	}

	getWebhookInfo() {
		return this.call<WebhookInfo>("getWebhookInfo");
	}

	setMyCommands(commands: BotCommand[]) {
		return this.call<true>("setMyCommands", { commands });
	}

	createInvoiceLink(params: CreateInvoiceLinkParams) {
		return this.call<string>("createInvoiceLink", {
			provider_token: "",
			...params,
		});
	}

	sendInvoice(params: SendInvoiceParams) {
		return this.call<Message>("sendInvoice", { provider_token: "", ...params });
	}

	answerPreCheckoutQuery(params: AnswerPreCheckoutQueryParams) {
		return this.call<true>("answerPreCheckoutQuery", params);
	}

	refundStarPayment(params: {
		user_id: number;
		telegram_payment_charge_id: string;
	}) {
		return this.call<true>("refundStarPayment", params);
	}

	editUserStarSubscription(params: {
		user_id: number;
		telegram_payment_charge_id: string;
		is_canceled: boolean;
	}) {
		return this.call<true>("editUserStarSubscription", params);
	}

	getMyStarBalance() {
		return this.call<StarAmount>("getMyStarBalance");
	}

	getStarTransactions(params: { offset?: number; limit?: number } = {}) {
		return this.call<StarTransactions>("getStarTransactions", params);
	}

	sendMessage(params: SendMessageParams) {
		return this.call<Message>("sendMessage", params);
	}
}
