// The subset of Bot API types StarPay uses. Field names mirror
// https://core.telegram.org/bots/api exactly.

export type User = {
	id: number;
	is_bot: boolean;
	first_name: string;
	last_name?: string;
	username?: string;
	language_code?: string;
	is_premium?: boolean;
};

export type Chat = {
	id: number;
	type: "private" | "group" | "supergroup" | "channel";
	username?: string;
};

export type SuccessfulPayment = {
	currency: string;
	total_amount: number;
	invoice_payload: string;
	subscription_expiration_date?: number;
	is_recurring?: true;
	is_first_recurring?: true;
	telegram_payment_charge_id: string;
	provider_payment_charge_id: string;
};

export type RefundedPayment = {
	currency: "XTR";
	total_amount: number;
	invoice_payload: string;
	telegram_payment_charge_id: string;
	provider_payment_charge_id?: string;
};

export type Message = {
	message_id: number;
	date: number;
	chat: Chat;
	from?: User;
	text?: string;
	successful_payment?: SuccessfulPayment;
	refunded_payment?: RefundedPayment;
};

export type PreCheckoutQuery = {
	id: string;
	from: User;
	currency: string;
	total_amount: number;
	invoice_payload: string;
};

export type Update = {
	update_id: number;
	message?: Message;
	pre_checkout_query?: PreCheckoutQuery;
};

export type WebhookInfo = {
	url: string;
	has_custom_certificate: boolean;
	pending_update_count: number;
	last_error_date?: number;
	last_error_message?: string;
	max_connections?: number;
	allowed_updates?: string[];
};

export type LabeledPrice = { label: string; amount: number };

export type StarAmount = { amount: number; nanostar_amount?: number };

export type TransactionPartner = {
	type: string;
	user?: User;
	invoice_payload?: string;
	subscription_period?: number;
	withdrawal_state?: { type: string };
	[key: string]: unknown;
};

export type StarTransaction = {
	id: string;
	amount: number;
	nanostar_amount?: number;
	date: number;
	source?: TransactionPartner;
	receiver?: TransactionPartner;
};

export type StarTransactions = { transactions: StarTransaction[] };

export type BotCommand = { command: string; description: string };

export type AllowedUpdate = "message" | "pre_checkout_query";

// ── Method parameters ──

export type SetWebhookParams = {
	url: string;
	secret_token: string;
	allowed_updates?: AllowedUpdate[];
	drop_pending_updates?: boolean;
	max_connections?: number;
};

export type CreateInvoiceLinkParams = {
	title: string;
	description: string;
	payload: string;
	currency: "XTR";
	prices: LabeledPrice[];
	subscription_period?: number;
	photo_url?: string;
	provider_token?: "";
};

export type SendInvoiceParams = Omit<
	CreateInvoiceLinkParams,
	"subscription_period"
> & {
	chat_id: number | string;
};

export type AnswerPreCheckoutQueryParams = {
	pre_checkout_query_id: string;
	ok: boolean;
	error_message?: string;
};

export type SendMessageParams = {
	chat_id: number | string;
	text: string;
	parse_mode?: "HTML" | "MarkdownV2";
};
