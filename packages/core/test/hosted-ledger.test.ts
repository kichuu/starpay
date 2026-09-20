// Hosted mode: StarPay's bot takes the payment, the ledger tracks what each
// merchant is owed, and payouts send TON. Runs in "live" mode so the platform
// bot doesn't affect the direct-mode tests, which use "test".
import { randomBytes } from "node:crypto";

import { createPrismaClient } from "@starpay/db";
import type { Update } from "@starpay/telegram";
import { Address } from "@ton/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { SecretBox } from "../src/crypto";
import type { Actor, Deps, Scope } from "../src/deps";
import { createServices } from "../src/index";
import { computeFee } from "../src/ledger/fees";
import { PLATFORM_ORG_ID } from "../src/platform";
import type { TonWallet } from "../src/ton";
import { FakeTelegram } from "./fake-telegram";
import { TEST_DATABASE_URL } from "./global-setup";

const db = createPrismaClient({ DATABASE_URL: TEST_DATABASE_URL });
// Fixed key: bots persist across tests and runs in the shared test database.
const TEST_BOX = new SecretBox(Buffer.alloc(32, 7).toString("base64"));
afterAll(() => db.$disconnect());

const DAY = 86_400_000;
const BUYER = {
	id: 6_142_883_901,
	is_bot: false,
	first_name: "Astro",
	username: "astro_kid",
};
let TON_ADDRESS: string;

class FakeWallet implements TonWallet {
	readonly network = "testnet" as const;
	readonly address = "UQ-fake-hot-wallet";
	seqno = 7;
	transfers: { seqno: number; to: string; amountNano: bigint }[] = [];
	async getSeqno() {
		return this.seqno;
	}
	async getBalance() {
		return 5_000_000_000n;
	}
	async transfer(input: { seqno: number; to: string; amountNano: bigint }) {
		this.transfers.push(input);
	}
}

let clock: Date;
let telegram: FakeTelegram;
let wallet: FakeWallet | null;
let services: ReturnType<typeof createServices>;
let scope: Scope;
const admin: Actor = { type: "user", id: "user_admin" };
const merchant: Actor = { type: "user", id: "user_merchant" };
let platformBot: { id: string; webhookSecret: string };
let updateId = Math.floor(Math.random() * 1_000_000_000);

beforeEach(async () => {
	clock = new Date("2026-09-01T12:00:00Z");
	telegram = new FakeTelegram();
	wallet = null;
	// Unique per test: payouts left queued by other tests must not match.
	TON_ADDRESS = new Address(0, randomBytes(32)).toString({ bounceable: false });
	const deps: Deps = {
		db,
		box: TEST_BOX,
		config: {
			publicApiUrl: "https://api.starpay.test",
			encryptionKey: "",
			starUsdRate: 0.013,
		},
		now: () => clock,
		telegram: () => telegram,
		tonWallet: async () => wallet,
		rates: { tonUsd: async () => 5 },
	};
	services = createServices(deps);
	scope = {
		organizationId: `org_${randomBytes(6).toString("hex")}`,
		mode: "live",
	};

	await services.admin.connectPlatformBot(
		"live",
		`${telegram.botId}:AAH-platform-token-000000000000000`,
		admin,
	);
	const bot = await db.bot.findUniqueOrThrow({
		where: {
			organizationId_mode: { organizationId: PLATFORM_ORG_ID, mode: "live" },
		},
	});
	platformBot = { id: bot.id, webhookSecret: bot.webhookSecret };

	// A plan just for this merchant: 5% + 2 Stars, 10-Star payout fee, 100 minimum, 10% reserve over 30 days.
	const plan = await services.admin.createFeePlan({
		name: `test-${scope.organizationId}`,
		percent_bps: 500,
		fixed_stars: 2,
		payout_fee_stars: 10,
		min_payout_stars: 100,
		hold_days: 21,
		reserve_bps: 1000,
		reserve_days: 30,
	});
	await services.admin.setMerchantFeePlan(scope.organizationId, plan.id, admin);
	await services.products.create(scope, {
		name: "Season Pass",
		description: "All season rewards.",
		price: 600,
		type: "one_time",
		lookup_key: "season_pass",
	});
});

async function pay(amount = 600) {
	const order = await services.orders.create(
		scope,
		{ product: "season_pass", expires_in: 3600, delivery: "link" },
		merchant,
	);
	await services.telegramUpdates.handle(
		platformBot.id,
		platformBot.webhookSecret,
		{
			update_id: updateId++,
			message: {
				message_id: 1,
				date: 0,
				chat: { id: BUYER.id, type: "private" },
				from: BUYER,
				successful_payment: {
					currency: "XTR",
					total_amount: amount,
					invoice_payload: order.id,
					telegram_payment_charge_id: `ch_${randomBytes(8).toString("hex")}`,
					provider_payment_charge_id: "",
				},
			},
		} satisfies Update,
	);
	return order;
}

const balance = () => services.payouts.balance(scope);

/** Every ledger transaction in the database sums to zero (the trigger enforces it; this proves it). */
async function expectBooksBalance() {
	const rows = await db.$queryRaw<{ unbalanced: bigint }[]>`
		SELECT COUNT(*)::bigint AS unbalanced FROM (
			SELECT "transactionId" FROM ledger_entry GROUP BY "transactionId" HAVING SUM(amount) <> 0
		) t`;
	expect(Number(rows[0]?.unbalanced)).toBe(0);
}

describe("fees", () => {
	it("rounds the percentage half up, adds the flat part and never exceeds the amount", () => {
		expect(computeFee(600, { percentBps: 500, fixedStars: 2 })).toBe(32);
		expect(computeFee(10, { percentBps: 500, fixedStars: 0 })).toBe(1); // 0.5 → 1
		expect(computeFee(9, { percentBps: 500, fixedStars: 0 })).toBe(0); // 0.45 → 0
		expect(computeFee(1, { percentBps: 500, fixedStars: 5 })).toBe(1);
	});
});

describe("hosted payments", () => {
	it("uses StarPay's bot when the merchant has none, and books fee and net", async () => {
		const order = await pay();
		const view = await services.orders.retrieve(scope, order.id);
		expect(view).toMatchObject({
			status: "paid",
			settlement: "platform",
			fee: 32,
		});

		expect(await balance()).toMatchObject({
			settlement: "platform",
			pending: 568,
			available: 0,
			withdrawable: 0,
			next_release: { stars: 568 },
		});
		await expectBooksBalance();
	});

	it("releases earnings after the hold period, keeping the rolling reserve", async () => {
		await pay();
		expect(await services.settlement.releaseDue()).toBe(0);

		clock = new Date(clock.getTime() + 21 * DAY + 1000);
		expect(await services.settlement.releaseDue()).toBeGreaterThanOrEqual(1);
		// 10% of 568 released in the last 30 days stays in reserve.
		expect(await balance()).toMatchObject({
			pending: 0,
			available: 568,
			reserved: 56,
			withdrawable: 512,
		});

		clock = new Date(clock.getTime() + 31 * DAY);
		expect(await balance()).toMatchObject({
			available: 568,
			reserved: 0,
			withdrawable: 568,
		});
	});

	it("reverses a refund before release, fee included, and never releases it", async () => {
		const order = await pay();
		await services.payments.refund(scope, order.id, merchant);
		expect(await balance()).toMatchObject({ pending: 0, available: 0 });

		clock = new Date(clock.getTime() + 22 * DAY);
		await services.settlement.releaseDue();
		expect(await balance()).toMatchObject({ pending: 0, available: 0 });
		await expectBooksBalance();
	});

	it("takes a refund after payout from available, which may go negative", async () => {
		const order = await pay();
		clock = new Date(clock.getTime() + 60 * DAY);
		await services.settlement.releaseDue();
		await services.settings.update(
			scope,
			{ payout_ton_address: TON_ADDRESS },
			merchant,
		);
		await services.payouts.request(scope, 558, merchant); // 558 + 10 fee = everything

		await services.payments.refund(scope, order.id, merchant);
		expect(await balance()).toMatchObject({
			available: -568,
			in_payout: 558,
			withdrawable: 0,
		});
		await expectBooksBalance();
	});
});

describe("payouts", () => {
	async function fundedMerchant() {
		await pay();
		clock = new Date(clock.getTime() + 60 * DAY); // past hold and reserve windows
		await services.settlement.releaseDue();
		await services.settings.update(
			scope,
			{ payout_ton_address: TON_ADDRESS },
			merchant,
		);
	}

	it("validates address, minimum and balance", async () => {
		await pay();
		clock = new Date(clock.getTime() + 60 * DAY);
		await services.settlement.releaseDue();

		await expect(
			services.payouts.request(scope, 200, merchant),
		).rejects.toMatchObject({
			code: "PAYOUT_ADDRESS_MISSING",
		});
		await expect(
			services.settings.update(
				scope,
				{ payout_ton_address: "not-an-address" },
				merchant,
			),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		await services.settings.update(
			scope,
			{ payout_ton_address: TON_ADDRESS },
			merchant,
		);
		await expect(
			services.payouts.request(scope, 50, merchant),
		).rejects.toMatchObject({ code: "PAYOUT_BELOW_MINIMUM" });
		await expect(
			services.payouts.request(scope, 560, merchant),
		).rejects.toMatchObject({
			code: "INSUFFICIENT_BALANCE",
			data: { withdrawable: 568, needed: 570 },
		});
	});

	it("moves money to in-payout, charges the fee, and refunds both on cancel", async () => {
		await fundedMerchant();
		const payout = await services.payouts.request(scope, 300, merchant);
		expect(payout).toMatchObject({ status: "requested", amount: 300, fee: 10 });
		expect(await balance()).toMatchObject({ available: 258, in_payout: 300 });

		await services.payouts.cancel(scope, payout.id, merchant);
		expect(await balance()).toMatchObject({ available: 568, in_payout: 0 });
		await expect(
			services.payouts.cancel(scope, payout.id, merchant),
		).rejects.toMatchObject({
			code: "PAYOUT_NOT_ALLOWED",
		});
		await expectBooksBalance();
	});

	it("never lets concurrent requests spend the same balance", async () => {
		await fundedMerchant();
		const results = await Promise.allSettled([
			services.payouts.request(scope, 400, merchant),
			services.payouts.request(scope, 400, merchant),
			services.payouts.request(scope, 400, merchant),
		]);
		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect(await balance()).toMatchObject({ available: 158, in_payout: 400 });
	});

	it("marks a manual payout paid (money leaves the treasury) or failed (money returns)", async () => {
		await fundedMerchant();
		const first = await services.payouts.request(scope, 200, merchant);
		await services.admin.markPaid(first.id, "ton-tx-abc", admin);
		expect(await balance()).toMatchObject({ available: 358, in_payout: 0 });

		const second = await services.payouts.request(scope, 200, merchant);
		await services.admin.markFailed(second.id, "wallet rejected", admin);
		expect(await balance()).toMatchObject({ available: 358, in_payout: 0 });
		await expect(
			services.admin.markPaid(second.id, "late", admin),
		).rejects.toMatchObject({ code: "PAYOUT_NOT_ALLOWED" });

		const ledger = await services.payouts.ledger(scope, { limit: 20 });
		expect(ledger.data.map((entry) => entry.type)).toEqual(
			expect.arrayContaining([
				"payment",
				"release",
				"payout_request",
				"payout_paid",
				"payout_reversed",
			]),
		);
		await expectBooksBalance();
	});

	it("sends automatically with a reserved seqno and confirms from the wallet", async () => {
		await fundedMerchant();
		wallet = new FakeWallet();
		const payout = await services.payouts.request(scope, 500, merchant);

		// Drain any payouts other tests left queued in this shared database.
		let result = await services.payouts.processNext("live");
		for (
			let i = 0;
			i < 20 && wallet.transfers.at(-1)?.to !== TON_ADDRESS;
			i++
		) {
			wallet.seqno++;
			result = await services.payouts.processNext("live");
		}
		expect(result).toBe("waiting");
		const transfer = wallet.transfers.at(-1);
		// 500 Stars × $0.013 ÷ $5 per TON = 1.3 TON
		expect(transfer).toMatchObject({
			to: TON_ADDRESS,
			amountNano: 1_300_000_000n,
		});

		// Nothing new is sent while the transfer is unconfirmed.
		const sentCount = wallet.transfers.length;
		expect(await services.payouts.processNext("live")).toBe("waiting");
		expect(wallet.transfers).toHaveLength(sentCount);

		// The wallet accepted it: seqno moved on.
		wallet.seqno = (transfer?.seqno ?? 0) + 1;
		expect(await services.payouts.processNext("live")).toBe("sent");
		const [paid] = (await services.payouts.list(scope, { limit: 5 })).data;
		expect(paid).toMatchObject({
			id: payout.id,
			status: "paid",
			ton_amount: "1.3",
		});
		expect(await balance()).toMatchObject({ in_payout: 0 });
		await expectBooksBalance();
	});

	it("re-sends with the same seqno once an unconfirmed message has expired", async () => {
		await fundedMerchant();
		wallet = new FakeWallet();
		await services.payouts.request(scope, 500, merchant);
		for (
			let i = 0;
			i < 20 && wallet.transfers.at(-1)?.to !== TON_ADDRESS;
			i++
		) {
			await services.payouts.processNext("live");
			if (wallet.transfers.at(-1)?.to !== TON_ADDRESS) wallet.seqno++;
		}
		const first = wallet.transfers.at(-1);

		clock = new Date(clock.getTime() + 4 * 60_000);
		expect(await services.payouts.processNext("live")).toBe("waiting");
		expect(wallet.transfers.at(-1)).toEqual(first); // same seqno, same amount
	});
});
