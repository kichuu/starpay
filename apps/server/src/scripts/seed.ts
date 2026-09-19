/**
 * Demo data for local development: `pnpm db:seed`.
 *
 * Creates demo@starpay.dev / starpay-demo with a "Pixel Forge" merchant in TEST
 * mode, a stub bot, products and ~30 days of orders, payments and refunds. All
 * of it goes through the real services; only Telegram is stubbed. Safe to
 * re-run: it skips the user and merchant if they already exist.
 */
import { randomBytes } from "node:crypto";

import { createDeps, createServices, type Scope } from "@starpay/core";
import { TelegramClient } from "@starpay/telegram";

import { ENV } from "../env.server";
import { auth, db } from "../services";

const EMAIL = "demo@starpay.dev";
const PASSWORD = "starpay-demo";

/** Answers the Bot API calls the seed needs without touching Telegram. */
class StubTelegram extends TelegramClient {
	constructor() {
		super({ token: "0:stub" });
	}
	override async call<T>(
		method: string,
		params: Record<string, unknown> = {},
	): Promise<T> {
		const results: Record<string, unknown> = {
			getMe: {
				id: 7_412_889_301,
				is_bot: true,
				first_name: "Pixel Forge Shop",
				username: "pixelforge_bot",
			},
			createInvoiceLink: `https://t.me/$demo_${String(params.payload)}`,
			refundStarPayment: true,
		};
		return (results[method] ?? true) as T;
	}
}

const PRODUCTS = [
	{
		lookup_key: "nebula_skins",
		name: "Nebula Skin Pack",
		description: "Six cosmetic skins for the Nebula season.",
		price: 250,
	},
	{
		lookup_key: "gems_500",
		name: "500 Gems",
		description: "Soft-currency top-up, credited instantly.",
		price: 100,
	},
	{
		lookup_key: "gems_1200",
		name: "1200 Gems",
		description: "Bonus 200 gems over the base pack.",
		price: 220,
	},
	{
		lookup_key: "season_pass",
		name: "Season Pass",
		description: "All season rewards plus a bonus track.",
		price: 600,
	},
	{
		lookup_key: "starter_bundle",
		name: "Starter Bundle",
		description: "Gems, a skin and a 3-day boost.",
		price: 150,
	},
] as const;

const BUYERS = [
	["astro_kid", "Astro"],
	["mira.dev", "Mira"],
	["tonyvx", "Tony"],
	["kaz_plays", "Kaz"],
	["juno_r", "Juno"],
	["dev_sasha", "Sasha"],
	["lumen88", "Lumen"],
	["nova_q", "Nova"],
	["pixel_ari", "Ari"],
	["mika_ng", "Mika"],
	["bryn.codes", "Bryn"],
	["ravi_s", "Ravi"],
] as const;

function pick<const Items extends readonly [unknown, ...unknown[]]>(
	items: Items,
): Items[number] {
	return items[Math.floor(Math.random() * items.length)] ?? items[0];
}

async function main() {
	// 1. User and merchant.
	let user = await db.user.findUnique({ where: { email: EMAIL } });
	if (!user) {
		await auth.api.signUpEmail({
			body: { email: EMAIL, password: PASSWORD, name: "Ana Reyes" },
		});
		user = await db.user.findUniqueOrThrow({ where: { email: EMAIL } });
	}
	const existing = await db.member.findFirst({ where: { userId: user.id } });
	if (existing) {
		console.log(
			`Demo merchant already exists. Sign in as ${EMAIL} / ${PASSWORD}.`,
		);
		return;
	}
	const organizationId = `org_demo_${randomBytes(4).toString("hex")}`;
	await db.organization.create({
		data: {
			id: organizationId,
			name: "Pixel Forge",
			slug: `pixel-forge-${organizationId.slice(-8)}`,
			createdAt: new Date(),
		},
	});
	await db.member.create({
		data: {
			id: randomBytes(12).toString("hex"),
			organizationId,
			userId: user.id,
			role: "owner",
			createdAt: new Date(),
		},
	});

	// 2. Services on a movable clock, with Telegram stubbed.
	let clock = new Date();
	const telegram = new StubTelegram();
	const deps = {
		...createDeps(db, {
			publicApiUrl: ENV.PUBLIC_API_URL,
			encryptionKey: ENV.ENCRYPTION_KEY,
		}),
		now: () => clock,
		telegram: () => telegram,
	};
	const services = createServices(deps);
	const scope: Scope = { organizationId, mode: "test" };
	const actor = { type: "user" as const, id: user.id };

	await services.bots.connect(
		scope,
		"7412889301:AAH-demo-token-not-real-000000000000",
		actor,
	);
	const bot = await db.bot.findUniqueOrThrow({
		where: { organizationId_mode: { organizationId, mode: "test" } },
	});
	for (const product of PRODUCTS) {
		await services.products.create(scope, { ...product, type: "one_time" });
	}
	await services.settings.update(
		scope,
		{
			pay_support_text:
				"Need help with a purchase? Reply here or email support@pixelforge.dev. We answer within 24 hours.",
		},
		actor,
	);

	// 3. ~30 days of traffic, busier recently; about 70% of invoices get paid.
	const start = Date.now();
	let updateId = 1;
	let orders = 0;
	for (let daysAgo = 29; daysAgo >= 0; daysAgo--) {
		const perDay =
			3 + Math.floor(Math.random() * 4) + Math.floor((29 - daysAgo) / 6);
		for (let i = 0; i < perDay; i++) {
			const at = new Date(
				start - daysAgo * 86_400_000 - Math.random() * 16 * 3_600_000,
			);
			if (at.getTime() > start) continue;
			clock = at;
			const product = pick(PRODUCTS);
			const [username, firstName] = pick(BUYERS);
			const buyer = {
				id:
					5_000_000_000 +
					(username.length * 7919 + firstName.charCodeAt(0)) * 1000,
				is_bot: false,
				first_name: firstName,
				username,
			};
			const order = await services.orders.create(
				scope,
				{
					product: product.lookup_key,
					expires_in: 3600,
					delivery: "link",
					reference: `order-${1000 + orders}`,
				},
				{ type: "api_key", id: "key_seed" },
			);
			orders++;

			const roll = Math.random();
			if (roll < 0.12) continue; // left unpaid: expires later
			clock = new Date(at.getTime() + 20_000);
			await services.telegramUpdates.handle(bot.id, bot.webhookSecret, {
				update_id: updateId++,
				pre_checkout_query: {
					id: `pcq_${updateId}`,
					from: buyer,
					currency: "XTR",
					total_amount: product.price,
					invoice_payload: order.id,
				},
			});
			if (roll < 0.25) continue; // abandoned after pre-checkout
			clock = new Date(at.getTime() + 35_000);
			await services.telegramUpdates.handle(bot.id, bot.webhookSecret, {
				update_id: updateId++,
				message: {
					message_id: updateId,
					date: Math.floor(clock.getTime() / 1000),
					chat: { id: buyer.id, type: "private" },
					from: buyer,
					successful_payment: {
						currency: "XTR",
						total_amount: product.price,
						invoice_payload: order.id,
						telegram_payment_charge_id: `stxDemo${randomBytes(10).toString("hex")}`,
						provider_payment_charge_id: "",
					},
				},
			});
			if (roll > 0.96) {
				clock = new Date(at.getTime() + 3_600_000);
				if (clock.getTime() < start)
					await services.payments.refund(scope, order.id, actor);
			}
		}
	}

	// Unpaid orders older than their hour are expired, as the expiry job will do.
	clock = new Date(start);
	await db.order.updateMany({
		where: {
			organizationId,
			status: { in: ["created", "pre_checkout"] },
			expiresAt: { lt: clock },
		},
		data: { status: "expired", failureReason: "expired" },
	});

	const key = await services.apiKeys.create(scope, "Local development", actor);
	console.log(`Seeded ${orders} orders for Pixel Forge (Test mode).`);
	console.log(
		`Sign in as ${EMAIL} / ${PASSWORD}, then switch the sidebar to Test.`,
	);
	console.log(`Test API key (shown once): ${key.secret}`);
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(() => db.$disconnect());
