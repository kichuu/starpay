// Platform operations for StarPay staff: hosted-mode money, payouts and fee plans.
import type { AdminOverview, FeePlanView } from "@starpay/contracts";
import type { Mode } from "@starpay/db";

import type { Actor, Deps } from "../deps";
import { errors } from "../errors";
import { newId } from "../ids";
import { owed, post, totalsByType } from "../ledger/ledger";
import { type PageArgs, pageQuery, toPage } from "../pagination";
import { PLATFORM_ORG_ID } from "../platform";
import { serializeFeePlan, serializePayout } from "../serializers";
import { audit } from "./audit";
import type { BotService } from "./bots";
import type { PayoutService } from "./payouts";

type FeePlanInput = Omit<FeePlanView, "id" | "is_default">;

const toPlanData = (input: Partial<FeePlanInput>) => ({
	name: input.name,
	percentBps: input.percent_bps,
	fixedStars: input.fixed_stars,
	payoutFeeStars: input.payout_fee_stars,
	minPayoutStars: input.min_payout_stars,
	holdDays: input.hold_days,
	reserveBps: input.reserve_bps,
	reserveDays: input.reserve_days,
});

export function createAdminService(
	deps: Deps,
	bots: BotService,
	payouts: PayoutService,
) {
	const { db } = deps;
	const platformScope = (mode: Mode) => ({
		organizationId: PLATFORM_ORG_ID,
		mode,
	});

	return {
		isPlatformAdmin(userId: string) {
			return (deps.config.platformAdminUserIds ?? []).includes(userId);
		},

		async overview(mode: Mode): Promise<AdminOverview> {
			const [totals, bot, waiting, wallet] = await Promise.all([
				db.$transaction((tx) => totalsByType(tx, mode)),
				bots.platformBot(mode),
				db.payout.count({
					where: { mode, status: { in: ["requested", "sending"] } },
				}),
				deps.tonWallet(mode).catch(() => null),
			]);
			let telegramActual: number | null = null;
			if (bot) {
				telegramActual = await bots
					.clientFor(bot)
					.getMyStarBalance()
					.then((balance) => balance.amount)
					.catch(() => null);
			}
			return {
				mode,
				platform_bot: bot
					? { id: bot.id, username: bot.username, status: bot.status }
					: null,
				platform: {
					telegram_ledger: totals.platform_telegram,
					telegram_actual: telegramActual,
					treasury: totals.platform_treasury,
					// Revenue accounts carry credit (negative) balances.
					fees_earned: owed(totals.platform_fees),
				},
				liabilities: {
					pending: owed(totals.merchant_pending),
					available: owed(totals.merchant_available),
					in_payout: owed(totals.merchant_payouts),
				},
				payouts_waiting: waiting,
				automatic_payouts: Boolean(wallet),
				wallet_address: wallet?.address ?? null,
			};
		},

		async listPayouts(
			args: PageArgs & {
				mode: Mode;
				status?: "requested" | "sending" | "paid" | "failed" | "cancelled";
			},
		) {
			const page = pageQuery(args);
			const rows = await db.payout.findMany({
				...page,
				where: { ...page.where, mode: args.mode, status: args.status },
			});
			const organizations = await db.organization.findMany({
				where: {
					id: { in: [...new Set(rows.map((row) => row.organizationId))] },
				},
				select: { id: true, name: true },
			});
			const names = new Map(organizations.map((org) => [org.id, org.name]));
			return toPage(rows, args.limit, (row) => ({
				...serializePayout(row),
				organization: {
					id: row.organizationId,
					name: names.get(row.organizationId) ?? row.organizationId,
				},
			}));
		},

		async markPaid(id: string, txReference: string, actor: Actor) {
			const payout = await payouts.markPaid(id, txReference, actor);
			if (!payout) throw errors.payoutNotAllowed(id, "already finished");
			return serializePayout(payout);
		},

		async markFailed(id: string, reason: string, actor: Actor) {
			const payout = await payouts.markFailed(id, reason, actor);
			if (!payout) throw errors.payoutNotAllowed(id, "already finished");
			return serializePayout(payout);
		},

		/** Stars withdrawn from the platform bot on Fragment now sit in the TON treasury. */
		async recordWithdrawal(
			input: {
				mode: Mode;
				stars: number;
				ton_received?: string;
				note?: string;
			},
			actor: Actor,
		) {
			const now = deps.now();
			await db.$transaction(async (tx) => {
				const id = newId("ledgerTransaction", now.getTime());
				await post(tx, {
					mode: input.mode,
					type: "fragment_withdrawal",
					description: `Fragment withdrawal of ${input.stars} Stars${input.note ? ` (${input.note})` : ""}`,
					idempotencyKey: `fragment_withdrawal:${id}`,
					metadata: {
						ton_received: input.ton_received ?? null,
						note: input.note ?? null,
					},
					at: now,
					lines: [
						{
							type: "platform_treasury",
							organizationId: PLATFORM_ORG_ID,
							amount: input.stars,
						},
						{
							type: "platform_telegram",
							organizationId: PLATFORM_ORG_ID,
							amount: -input.stars,
						},
					],
				});
				await audit(
					tx,
					platformScope(input.mode),
					actor,
					"platform.fragment_withdrawal",
					undefined,
					input,
				);
			});
			return { ok: true as const };
		},

		// ── Fee plans ──

		async listFeePlans() {
			const plans = await db.feePlan.findMany({
				orderBy: { createdAt: "asc" },
			});
			return plans.map(serializeFeePlan);
		},

		async createFeePlan(input: FeePlanInput) {
			const plan = await db.feePlan.create({
				data: {
					id: newId("feePlan"),
					name: input.name,
					percentBps: input.percent_bps,
					fixedStars: input.fixed_stars,
					payoutFeeStars: input.payout_fee_stars,
					minPayoutStars: input.min_payout_stars,
					holdDays: input.hold_days,
					reserveBps: input.reserve_bps,
					reserveDays: input.reserve_days,
				},
			});
			return serializeFeePlan(plan);
		},

		/** Changes apply to future payments only; each payment keeps the fee it was charged. */
		async updateFeePlan(id: string, input: Partial<FeePlanInput>) {
			const plan = await db.feePlan.update({
				where: { id },
				data: toPlanData(input),
			});
			return serializeFeePlan(plan);
		},

		async setDefaultFeePlan(id: string) {
			const plan = await db.$transaction(async (tx) => {
				await tx.feePlan.updateMany({
					where: { isDefault: true },
					data: { isDefault: false },
				});
				return tx.feePlan.update({ where: { id }, data: { isDefault: true } });
			});
			return serializeFeePlan(plan);
		},

		async listMerchants(mode: Mode) {
			const [organizations, settings, balances] = await Promise.all([
				db.organization.findMany({
					select: { id: true, name: true },
					orderBy: { createdAt: "desc" },
					take: 500,
				}),
				db.merchantSettings.findMany({
					select: { organizationId: true, feePlanId: true },
				}),
				db.$queryRaw<
					{ organizationId: string; type: string; balance: bigint }[]
				>`
					SELECT a."organizationId", a.type, COALESCE(SUM(e.amount), 0)::bigint AS balance
					FROM ledger_account a LEFT JOIN ledger_entry e ON e."accountId" = a.id
					WHERE a.mode = ${mode}::"Mode" AND a."organizationId" <> ${PLATFORM_ORG_ID}
					GROUP BY a."organizationId", a.type`,
			]);
			const plans = new Map(
				settings.map((row) => [row.organizationId, row.feePlanId]),
			);
			const owedTo = (id: string, type: string) =>
				owed(
					Number(
						balances.find(
							(row) => row.organizationId === id && row.type === type,
						)?.balance ?? 0,
					),
				);
			return organizations.map((org) => ({
				id: org.id,
				name: org.name,
				fee_plan_id: plans.get(org.id) ?? null,
				pending: owedTo(org.id, "merchant_pending"),
				available: owedTo(org.id, "merchant_available"),
				in_payout: owedTo(org.id, "merchant_payouts"),
			}));
		},

		async setMerchantFeePlan(
			organizationId: string,
			feePlanId: string | null,
			actor: Actor,
		) {
			await db.merchantSettings.upsert({
				where: { organizationId },
				create: { organizationId, feePlanId },
				update: { feePlanId },
			});
			await audit(
				db,
				{ organizationId, mode: "live" },
				actor,
				"merchant.fee_plan",
				organizationId,
				{ feePlanId },
			);
			return { ok: true as const };
		},

		async connectPlatformBot(mode: Mode, token: string, actor: Actor) {
			const view = await bots.connect(platformScope(mode), token, actor);
			return { id: view.id, username: view.username, status: view.status };
		},
	};
}

export type AdminService = ReturnType<typeof createAdminService>;
