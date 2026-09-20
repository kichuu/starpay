// Webhook delivery against a real HTTP server: signing, retries, the recorded
// request/response trail, resend and the SSRF guard.
import { createHmac, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createPrismaClient } from "@starpay/db";
import type { Update } from "@starpay/telegram";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { SecretBox } from "../src/crypto";
import type { Actor, Deps, Scope } from "../src/deps";
import { createServices } from "../src/index";
import { FakeTelegram } from "./fake-telegram";
import { TEST_DATABASE_URL } from "./global-setup";

const db = createPrismaClient({ DATABASE_URL: TEST_DATABASE_URL });
const TEST_BOX = new SecretBox(Buffer.alloc(32, 7).toString("base64"));
afterAll(() => db.$disconnect());

const BUYER = {
	id: 6_142_883_901,
	is_bot: false,
	first_name: "Astro",
	username: "astro_kid",
};

type Received = { headers: Record<string, string>; body: string };

/** A merchant's endpoint: records what arrives and answers however the test wants. */
class MerchantServer {
	readonly received: Received[] = [];
	reply: { status: number; body: string } = {
		status: 200,
		body: '{"ok":true}',
	};
	private server!: Server;
	url = "";

	async start() {
		this.server = createServer((request, response) => {
			const chunks: Buffer[] = [];
			request.on("data", (chunk) => chunks.push(chunk));
			request.on("end", () => {
				this.received.push({
					headers: request.headers as Record<string, string>,
					body: Buffer.concat(chunks).toString(),
				});
				response.writeHead(this.reply.status, {
					"content-type": "application/json",
					"x-served-by": "merchant",
				});
				response.end(this.reply.body);
			});
		});
		await new Promise<void>((resolve) =>
			this.server.listen(0, "127.0.0.1", resolve),
		);
		this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/hooks`;
	}

	async stop() {
		await new Promise<void>((resolve) => this.server.close(() => resolve()));
	}
}

let merchantServer: MerchantServer;
let services: ReturnType<typeof createServices>;
let clock: Date;
let scope: Scope;
let telegram: FakeTelegram;
let bot: { id: string; webhookSecret: string };
const actor: Actor = { type: "user", id: "user_test" };
let updateId = Math.floor(Math.random() * 1_000_000_000);

beforeEach(async () => {
	merchantServer = new MerchantServer();
	await merchantServer.start();
	clock = new Date("2026-09-20T10:00:00Z");
	telegram = new FakeTelegram();
	const deps: Deps = {
		db,
		box: TEST_BOX,
		config: { publicApiUrl: "https://api.starpay.test", encryptionKey: "" },
		now: () => clock,
		telegram: () => telegram,
		tonWallet: async () => null,
		rates: { tonUsd: async () => 5 },
	};
	services = createServices(deps);
	scope = {
		organizationId: `org_${randomBytes(6).toString("hex")}`,
		mode: "test",
	};

	await services.bots.connect(
		scope,
		`${telegram.botId}:AAH-token-0000000000000000000000`,
		actor,
	);
	const row = await db.bot.findUniqueOrThrow({
		where: {
			organizationId_mode: {
				organizationId: scope.organizationId,
				mode: "test",
			},
		},
	});
	bot = { id: row.id, webhookSecret: row.webhookSecret };
	await services.products.create(scope, {
		name: "Gems",
		description: "500 gems",
		price: 100,
		type: "one_time",
		lookup_key: "gems",
	});
});

afterEach(() => merchantServer.stop());

/** A paid order, which emits payment.succeeded to every active endpoint. */
async function paidOrder() {
	const order = await services.orders.create(
		scope,
		{ product: "gems", expires_in: 3600, delivery: "link" },
		actor,
	);
	await services.telegramUpdates.handle(bot.id, bot.webhookSecret, {
		update_id: updateId++,
		message: {
			message_id: 1,
			date: 0,
			chat: { id: BUYER.id, type: "private" },
			from: BUYER,
			successful_payment: {
				currency: "XTR",
				total_amount: 100,
				invoice_payload: order.id,
				telegram_payment_charge_id: `ch_${randomBytes(8).toString("hex")}`,
				provider_payment_charge_id: "",
			},
		},
	} satisfies Update);
	return order;
}

const deliveries = () => services.webhooks.listDeliveries(scope, { limit: 20 });

describe("endpoints", () => {
	it("rejects endpoints that aren't reachable from the internet", async () => {
		const live: Scope = { ...scope, mode: "live" };
		for (const url of [
			"http://example.com/hook",
			"https://127.0.0.1/hook",
			"https://192.168.1.10/hook",
		]) {
			await expect(
				services.webhooks.createEndpoint(live, { url, events: [] }, actor),
			).rejects.toMatchObject({ code: "BAD_REQUEST" });
		}
		// Test mode allows localhost so merchants can develop against their machine.
		const endpoint = await services.webhooks.createEndpoint(
			scope,
			{ url: merchantServer.url, events: [] },
			actor,
		);
		expect(endpoint.status).toBe("active");
	});

	it("reveals and rotates the signing secret, keeping the old one valid for a day", async () => {
		const endpoint = await services.webhooks.createEndpoint(
			scope,
			{ url: merchantServer.url, events: [] },
			actor,
		);
		const { secret: original } = await services.webhooks.revealSecret(
			scope,
			endpoint.id,
			actor,
		);
		expect(original).toMatch(/^whsec_/);

		const { secret: rotated } = await services.webhooks.rotateSecret(
			scope,
			endpoint.id,
			actor,
		);
		expect(rotated).not.toBe(original);

		await paidOrder();
		await services.webhooks.dispatchDue();
		const signature =
			merchantServer.received.at(-1)?.headers["x-starpay-signature"] ?? "";
		const body = merchantServer.received.at(-1)?.body ?? "";
		const timestamp = signature.match(/t=(\d+)/)?.[1];
		// Both secrets sign during the overlap, so a merchant mid-deploy keeps verifying.
		for (const secret of [original, rotated]) {
			const expected = createHmac("sha256", secret)
				.update(`${timestamp}.${body}`)
				.digest("hex");
			expect(signature).toContain(`v1=${expected}`);
		}
	});
});

describe("delivery", () => {
	it("sends a signed event and records the full request and response", async () => {
		await services.webhooks.createEndpoint(
			scope,
			{ url: merchantServer.url, events: [], description: "main" },
			actor,
		);
		const order = await paidOrder();

		expect(await services.webhooks.dispatchDue()).toBe(1);
		expect(merchantServer.received).toHaveLength(1);

		const sent = merchantServer.received[0];
		expect(sent?.headers["content-type"]).toBe("application/json");
		expect(sent?.headers["x-starpay-event-type"]).toBe("payment.succeeded");
		expect(sent?.headers["x-starpay-attempt"]).toBe("1");
		const payload = JSON.parse(sent?.body ?? "{}");
		expect(payload).toMatchObject({
			object: "event",
			type: "payment.succeeded",
			livemode: false,
			data: { object: { id: order.id, status: "paid", amount: 100 } },
		});

		const [delivery] = await deliveries();
		expect(delivery).toMatchObject({
			status: "succeeded",
			attempts: 1,
			lastStatusCode: 200,
		});

		const detail = await services.webhooks.getDelivery(
			scope,
			delivery?.id ?? "",
		);
		const attempt = detail.attemptLog[0];
		expect(attempt).toMatchObject({
			attempt: 1,
			url: merchantServer.url,
			statusCode: 200,
		});
		expect(attempt?.requestBody).toBe(sent?.body);
		expect(attempt?.responseBody).toBe('{"ok":true}');
		expect(
			(attempt?.responseHeaders as Record<string, string>)["x-served-by"],
		).toBe("merchant");
		expect(
			(attempt?.requestHeaders as Record<string, string>)[
				"x-starpay-signature"
			],
		).toContain("t=");
		expect(attempt?.latencyMs).toBeGreaterThanOrEqual(0);

		// The order's timeline records the delivery too.
		const timeline = await services.orders.detail(scope, order.id);
		expect(timeline.timeline.map((entry) => entry.type)).toContain(
			"webhook_delivered",
		);
	});

	it("retries with backoff and gives up after the last attempt", async () => {
		await services.webhooks.createEndpoint(
			scope,
			{ url: merchantServer.url, events: [] },
			actor,
		);
		merchantServer.reply = { status: 500, body: "boom" };
		const order = await paidOrder();

		await services.webhooks.dispatchDue();
		let [delivery] = await deliveries();
		expect(delivery).toMatchObject({
			status: "pending",
			attempts: 1,
			lastError: "HTTP 500",
		});
		// The retry is scheduled in the future, so a second run does nothing.
		expect(delivery?.nextAttemptAt.getTime()).toBeGreaterThan(clock.getTime());
		expect(await services.webhooks.dispatchDue()).toBe(0);

		for (let attempt = 2; attempt <= 5; attempt++) {
			clock = new Date(clock.getTime() + 7 * 3600 * 1000);
			await services.webhooks.dispatchDue();
		}
		[delivery] = await deliveries();
		expect(delivery).toMatchObject({ status: "failed", attempts: 5 });
		expect(merchantServer.received).toHaveLength(5);

		const detail = await services.webhooks.getDelivery(
			scope,
			delivery?.id ?? "",
		);
		expect(detail.attemptLog.map((row) => row.attempt)).toEqual([
			1, 2, 3, 4, 5,
		]);
		expect(detail.attemptLog.every((row) => row.responseBody === "boom")).toBe(
			true,
		);

		const timeline = await services.orders.detail(scope, order.id);
		expect(timeline.timeline.map((entry) => entry.type)).toContain(
			"webhook_failed",
		);
	});

	it("records a timeout as a failed attempt without a status code", async () => {
		await services.webhooks.createEndpoint(
			scope,
			{ url: `${merchantServer.url}/../unreachable`, events: [] },
			actor,
		);
		await merchantServer.stop();
		await paidOrder();

		await services.webhooks.dispatchDue();
		const [delivery] = await deliveries();
		expect(delivery).toMatchObject({
			status: "pending",
			attempts: 1,
			lastStatusCode: null,
		});
		expect(delivery?.lastError).toBeTruthy();
		await merchantServer.start(); // afterEach stops it again
	});

	it("only sends the events an endpoint subscribes to", async () => {
		await services.webhooks.createEndpoint(
			scope,
			{ url: merchantServer.url, events: ["payment.refunded"] },
			actor,
		);
		const order = await paidOrder();
		expect(await services.webhooks.dispatchDue()).toBe(0);

		await services.payments.refund(scope, order.id, actor);
		expect(await services.webhooks.dispatchDue()).toBe(1);
		expect(JSON.parse(merchantServer.received[0]?.body ?? "{}").type).toBe(
			"payment.refunded",
		);
	});

	it("resends the same event as a new delivery, keeping the old trail", async () => {
		await services.webhooks.createEndpoint(
			scope,
			{ url: merchantServer.url, events: [] },
			actor,
		);
		await paidOrder();
		await services.webhooks.dispatchDue();
		const [first] = await deliveries();

		const resent = await services.webhooks.resend(
			scope,
			first?.id ?? "",
			actor,
		);
		expect(resent.id).not.toBe(first?.id);
		await services.webhooks.dispatchDue();

		expect(merchantServer.received).toHaveLength(2);
		expect(merchantServer.received[0]?.body).toBe(
			merchantServer.received[1]?.body,
		);
		const all = await deliveries();
		expect(all.filter((row) => row.status === "succeeded")).toHaveLength(2);
	});

	it("stops delivering to a disabled endpoint", async () => {
		const endpoint = await services.webhooks.createEndpoint(
			scope,
			{ url: merchantServer.url, events: [] },
			actor,
		);
		await paidOrder();
		await services.webhooks.updateEndpoint(
			scope,
			{ id: endpoint.id, status: "disabled" },
			actor,
		);

		await services.webhooks.dispatchDue();
		expect(merchantServer.received).toHaveLength(0);
		const [delivery] = await deliveries();
		expect(delivery).toMatchObject({
			status: "failed",
			lastError: "Endpoint is disabled",
		});
	});

	it("sends a test event on demand", async () => {
		const endpoint = await services.webhooks.createEndpoint(
			scope,
			{ url: merchantServer.url, events: [] },
			actor,
		);
		const result = await services.webhooks.sendTest(
			scope,
			endpoint.id,
			"payment.succeeded",
			actor,
		);
		expect(result).toMatchObject({ succeeded: true, statusCode: 200 });
		expect(JSON.parse(merchantServer.received[0]?.body ?? "{}")).toMatchObject({
			type: "payment.succeeded",
			data: { object: { reference: "test-event" } },
		});
	});
});
