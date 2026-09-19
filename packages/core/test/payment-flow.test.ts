import { randomBytes } from "node:crypto";

import { createPrismaClient } from "@starpay/db";
import type { Update } from "@starpay/telegram";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { SecretBox } from "../src/crypto";
import type { Actor, Deps, Scope } from "../src/deps";
import { DomainError } from "../src/errors";
import { newId } from "../src/ids";
import { createServices } from "../src/index";
import { FakeTelegram } from "./fake-telegram";
import { TEST_DATABASE_URL } from "./global-setup";

const db = createPrismaClient({ DATABASE_URL: TEST_DATABASE_URL });
afterAll(() => db.$disconnect());

const BUYER = {
	id: 6142883901,
	is_bot: false,
	first_name: "Astro",
	username: "astro_kid",
};
const OTHER_USER = {
	id: 5521004412,
	is_bot: false,
	first_name: "Mira",
	username: "mira.dev",
};
const BOT_TOKEN = "7412889301:AAH-fake-token-for-tests-0000000000";

let telegram: FakeTelegram;
let clock: Date;
let services: ReturnType<typeof createServices>;
let scope: Scope;
let actor: Actor;
let updateId = 1;

/** Charge IDs are globally unique in Telegram, and the test DB persists across runs. */
const chargeId = (label: string) =>
	`tg_ch_${label}_${randomBytes(6).toString("hex")}`;

beforeEach(() => {
	telegram = new FakeTelegram();
	clock = new Date("2026-09-19T12:00:00Z");
	const deps: Deps = {
		db,
		box: new SecretBox(randomBytes(32).toString("base64")),
		config: { publicApiUrl: "https://api.starpay.test", encryptionKey: "" },
		now: () => clock,
		telegram: () => telegram,
	};
	services = createServices(deps);
	// A fresh merchant per test keeps tests independent on a shared database.
	scope = {
		organizationId: `org_${randomBytes(6).toString("hex")}`,
		mode: "test",
	};
	actor = { type: "user", id: "user_test" };
});

async function connectBot() {
	await services.bots.connect(scope, BOT_TOKEN, actor);
	const bot = await db.bot.findUniqueOrThrow({
		where: {
			organizationId_mode: {
				organizationId: scope.organizationId,
				mode: scope.mode,
			},
		},
	});
	return bot;
}

async function send(
	botId: string,
	secret: string,
	update: Omit<Update, "update_id">,
	id = updateId++,
) {
	return services.telegramUpdates.handle(botId, secret, {
		update_id: id,
		...update,
	});
}

function preCheckout(
	orderId: string,
	amount: number,
	from = BUYER,
): Omit<Update, "update_id"> {
	return {
		pre_checkout_query: {
			id: `pcq_${randomBytes(4).toString("hex")}`,
			from,
			currency: "XTR",
			total_amount: amount,
			invoice_payload: orderId,
		},
	};
}

function successfulPayment(
	orderId: string,
	amount: number,
	chargeId: string,
): Omit<Update, "update_id"> {
	return {
		message: {
			message_id: 10,
			date: 0,
			chat: { id: BUYER.id, type: "private" },
			from: BUYER,
			successful_payment: {
				currency: "XTR",
				total_amount: amount,
				invoice_payload: orderId,
				telegram_payment_charge_id: chargeId,
				provider_payment_charge_id: "",
			},
		},
	};
}

async function setupProductAndOrder(input: { telegram_user_id?: number } = {}) {
	const product = await services.products.create(scope, {
		name: "Nebula Skin Pack",
		description: "Six cosmetic skins for the Nebula season.",
		price: 250,
		type: "one_time",
		lookup_key: "nebula_skins",
	});
	const order = await services.orders.create(
		scope,
		{
			product: "nebula_skins",
			expires_in: 3600,
			delivery: "link",
			reference: "order-3391",
			...input,
		},
		{ type: "api_key", id: "key_test" },
	);
	return { product, order };
}

describe("bot connection", () => {
	it("stores an encrypted token and registers the webhook with a secret", async () => {
		const view = await services.bots.connect(scope, BOT_TOKEN, actor);
		expect(view).toMatchObject({
			username: "pixelforge_bot",
			status: "active",
			token_last4: "0000",
		});

		const bot = await db.bot.findUniqueOrThrow({ where: { id: view.id } });
		expect(bot.tokenEncrypted).not.toContain(BOT_TOKEN);

		const [setWebhook] = telegram.callsTo("setWebhook");
		expect(setWebhook?.params).toMatchObject({
			url: `https://api.starpay.test/telegram/webhook/${view.id}`,
			secret_token: bot.webhookSecret,
			allowed_updates: ["message", "pre_checkout_query"],
		});
	});

	it("rejects orders until a bot is connected", async () => {
		await services.products.create(scope, {
			name: "Gems",
			description: "500 gems",
			price: 100,
			type: "one_time",
		});
		await expect(
			services.orders.create(
				scope,
				{ product: "x", expires_in: 3600, delivery: "link" },
				actor,
			),
		).rejects.toMatchObject({ code: "BOT_NOT_CONNECTED" });
	});
});

describe("payment flow", () => {
	it("creates an order whose invoice payload is the order ID", async () => {
		await connectBot();
		const { order } = await setupProductAndOrder();

		expect(order).toMatchObject({
			status: "created",
			amount: 250,
			reference: "order-3391",
		});
		expect(order.invoice_link).toBe(`https://t.me/$fake_${order.id}`);
		expect(telegram.callsTo("createInvoiceLink")[0]?.params).toMatchObject({
			payload: order.id,
			currency: "XTR",
			prices: [{ label: "Nebula Skin Pack", amount: 250 }],
		});
	});

	it("authenticates Telegram updates by secret token", async () => {
		const bot = await connectBot();
		const { order } = await setupProductAndOrder();

		expect(
			await send(bot.id, "wrong-secret", preCheckout(order.id, 250)),
		).toEqual({ status: 401 });
		expect(
			await send("bot_missing", bot.webhookSecret, preCheckout(order.id, 250)),
		).toEqual({ status: 404 });
	});

	it("approves pre-checkout, records the payment once, and emits payment.succeeded", async () => {
		const bot = await connectBot();
		const { order } = await setupProductAndOrder();

		const approved = await send(
			bot.id,
			bot.webhookSecret,
			preCheckout(order.id, 250),
		);
		expect(approved).toMatchObject({
			status: 200,
			reply: { method: "answerPreCheckoutQuery", ok: true },
		});

		const charge = chargeId("paid");
		const paymentUpdate = successfulPayment(order.id, 250, charge);
		const paidUpdateId = updateId++;
		await send(bot.id, bot.webhookSecret, paymentUpdate, paidUpdateId);
		// Same update redelivered, and the same charge under a new update_id: both ignored.
		await send(bot.id, bot.webhookSecret, paymentUpdate, paidUpdateId);
		await send(bot.id, bot.webhookSecret, paymentUpdate);

		const paid = await services.orders.retrieve(scope, order.id);
		expect(paid).toMatchObject({
			status: "paid",
			telegram_payment_charge_id: charge,
			customer: { telegram_user_id: BUYER.id, username: "astro_kid" },
		});

		const customer = await db.customer.findFirstOrThrow({
			where: { organizationId: scope.organizationId },
		});
		expect(customer).toMatchObject({ totalSpent: 250, orderCount: 1 });
		expect(await db.payment.count({ where: { orderId: order.id } })).toBe(1);

		const events = await db.webhookEvent.findMany({
			where: { orderId: order.id },
		});
		expect(events.map((event) => event.type)).toEqual(["payment.succeeded"]);

		const detail = await services.orders.detail(scope, order.id);
		expect(detail.timeline.map((entry) => entry.type)).toEqual([
			"created",
			"pre_checkout_approved",
			"paid",
		]);
		expect(detail.raw_payment).toMatchObject({
			telegram_payment_charge_id: charge,
		});
	});

	it("rejects pre-checkout from a different user when the order has a payer", async () => {
		const bot = await connectBot();
		const { order } = await setupProductAndOrder({
			telegram_user_id: BUYER.id,
		});

		const result = await send(
			bot.id,
			bot.webhookSecret,
			preCheckout(order.id, 250, OTHER_USER),
		);
		expect(result).toMatchObject({ reply: { ok: false } });
		// The intended buyer can still pay.
		expect((await services.orders.retrieve(scope, order.id)).status).toBe(
			"created",
		);
	});

	it("expires the order when pre-checkout arrives too late", async () => {
		const bot = await connectBot();
		const { order } = await setupProductAndOrder();

		clock = new Date(clock.getTime() + 2 * 3600 * 1000);
		const result = await send(
			bot.id,
			bot.webhookSecret,
			preCheckout(order.id, 250),
		);
		expect(result).toMatchObject({ reply: { ok: false } });
		expect((await services.orders.retrieve(scope, order.id)).status).toBe(
			"expired",
		);
		const events = await db.webhookEvent.findMany({
			where: { orderId: order.id },
		});
		expect(events.map((event) => event.type)).toEqual(["order.expired"]);
	});

	it("still records a payment that arrives after the order expired", async () => {
		const bot = await connectBot();
		const { order } = await setupProductAndOrder();
		await services.orders.cancel(scope, order.id, actor);

		await send(
			bot.id,
			bot.webhookSecret,
			successfulPayment(order.id, 250, chargeId("late")),
		);
		expect((await services.orders.retrieve(scope, order.id)).status).toBe(
			"paid",
		);
		const detail = await services.orders.detail(scope, order.id);
		expect(detail.timeline.at(-1)).toMatchObject({
			type: "paid",
			data: { late_payment: true },
		});
	});

	it("refunds through Telegram and reverses the customer's spend", async () => {
		const bot = await connectBot();
		const { order } = await setupProductAndOrder();
		const charge = chargeId("refund");
		await send(
			bot.id,
			bot.webhookSecret,
			successfulPayment(order.id, 250, charge),
		);

		const refunded = await services.payments.refund(scope, order.id, actor);
		expect(refunded.status).toBe("refunded");
		expect(telegram.callsTo("refundStarPayment")[0]?.params).toEqual({
			user_id: BUYER.id,
			telegram_payment_charge_id: charge,
		});
		const customer = await db.customer.findFirstOrThrow({
			where: { organizationId: scope.organizationId },
		});
		expect(customer.totalSpent).toBe(0);

		await expect(
			services.payments.refund(scope, order.id, actor),
		).rejects.toMatchObject({
			code: "ORDER_NOT_REFUNDABLE",
		});
	});

	it("keeps merchants isolated from each other", async () => {
		await connectBot();
		const { order } = await setupProductAndOrder();
		const otherMerchant: Scope = {
			organizationId: "org_someone_else",
			mode: "test",
		};
		await expect(
			services.orders.retrieve(otherMerchant, order.id),
		).rejects.toBeInstanceOf(DomainError);
	});
});

describe("api keys and idempotency", () => {
	it("authenticates a key by hash and stops after revocation", async () => {
		const key = await services.apiKeys.create(
			scope,
			"Production server",
			actor,
		);
		expect(key.secret).toMatch(/^test_sk_/);
		expect(key.masked).not.toContain(key.secret);

		expect(await services.apiKeys.authenticate(key.secret)).toMatchObject({
			organizationId: scope.organizationId,
			mode: "test",
		});
		await services.apiKeys.revoke(scope, key.id, actor);
		expect(await services.apiKeys.authenticate(key.secret)).toBeNull();
	});

	it("replays the first response for a repeated Idempotency-Key", async () => {
		let calls = 0;
		const run = (body: unknown) =>
			services.idempotency.run(scope, "idem-1", body, async () => ({
				call: ++calls,
			}));

		expect(await run({ a: 1 })).toEqual({ call: 1 });
		expect(await run({ a: 1 })).toEqual({ call: 1 });
		await expect(run({ a: 2 })).rejects.toMatchObject({
			code: "IDEMPOTENCY_KEY_REUSED",
		});
	});
});

describe("helpers", () => {
	it("round-trips secrets and rejects tampering", () => {
		const box = new SecretBox(randomBytes(32).toString("base64"));
		const sealed = box.encrypt("hello");
		expect(box.decrypt(sealed)).toBe("hello");
		expect(() => box.decrypt(`${sealed.slice(0, -2)}xx`)).toThrow();
	});

	it("generates IDs that sort by creation time", () => {
		const earlier = newId("order", 1_700_000_000_000);
		const later = newId("order", 1_700_000_000_001);
		expect(earlier < later).toBe(true);
		expect(earlier).toMatch(/^ord_[0-9A-Z]{26}$/);
	});
});

describe("dashboard data", () => {
	async function paidOrder(
		bot: { id: string; webhookSecret: string },
		amount = 250,
	) {
		const order = await services.orders.create(
			scope,
			{ product: "nebula_skins", expires_in: 3600, delivery: "link" },
			actor,
		);
		await send(
			bot.id,
			bot.webhookSecret,
			successfulPayment(order.id, amount, chargeId("dash")),
		);
		return order;
	}

	it("reports net revenue, conversion and local-time buckets", async () => {
		const bot = await connectBot();
		const { order: unpaid } = await setupProductAndOrder();
		await paidOrder(bot);
		const refunded = await paidOrder(bot);
		await services.payments.refund(scope, refunded.id, actor);

		// 12:00 UTC is 17:30 in Kolkata: the 16:00–20:00 bucket.
		const today = await services.analytics.overview(
			scope,
			"today",
			"Asia/Kolkata",
		);
		expect(today.revenue).toEqual({ stars: 250, previous: 0 });
		expect(today.payments).toEqual({ count: 1, average: 250 });
		expect(today.conversion).toEqual({ created: 3, paid: 2 });
		expect(today.series.map((bucket) => bucket.label)).toEqual([
			"00",
			"04",
			"08",
			"12",
			"16",
			"20",
		]);
		expect(today.series.find((bucket) => bucket.label === "16")?.stars).toBe(
			250,
		);
		expect(today.recent.map((order) => order.id)).toContain(unpaid.id);

		const week = await services.analytics.overview(scope, "7d", "UTC");
		expect(week.series).toHaveLength(7);
		expect(week.series.at(-1)).toEqual({ label: "2026-09-19", stars: 250 });

		// Tomorrow, today's revenue becomes the previous period.
		clock = new Date("2026-09-20T12:00:00Z");
		const tomorrow = await services.analytics.overview(scope, "today", "UTC");
		expect(tomorrow.revenue).toEqual({ stars: 0, previous: 250 });
	});

	it("lists customers by spend and summarises subscriptions", async () => {
		const bot = await connectBot();
		await setupProductAndOrder();
		await paidOrder(bot);

		const customers = await services.customers.list(scope, {
			q: "@astro",
			limit: 10,
			offset: 0,
		});
		expect(customers.total).toBe(1);
		expect(customers.data[0]).toMatchObject({
			username: "astro_kid",
			total_spent: 250,
			order_count: 1,
		});

		expect(await services.subscriptions.stats(scope)).toEqual({
			active: 0,
			cancelled: 0,
			monthly_stars: 0,
		});
	});
});
