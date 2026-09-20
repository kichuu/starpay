// Hosted-mode balances and TON payouts. Balances always come from the ledger.
//
//   request:  merchant_available +(amount+fee) | merchant_payouts −amount | platform_fees −fee
//   paid:     merchant_payouts +amount          | platform_treasury −amount
//   reversed: merchant_payouts +amount | platform_fees +fee | merchant_available −(amount+fee)
import type { MerchantBalance, MerchantLedgerEntry } from "@starpay/contracts";
import type { Mode, Payout, Tx } from "@starpay/db";

import {
	type Actor,
	DEFAULT_STAR_USD_RATE,
	type Deps,
	type Scope,
} from "../deps";
import { errors } from "../errors";
import { newId } from "../ids";
import { planFor } from "../ledger/fees";
import {
	accountId,
	balancesOf,
	lockAccount,
	owed,
	post,
} from "../ledger/ledger";
import { type PageArgs, pageQuery, toPage } from "../pagination";
import { PLATFORM_ORG_ID } from "../platform";
import { serializeFeePlan, serializePayout } from "../serializers";
import { isValidTonAddress, starsToNanoTon } from "../ton";
import { audit } from "./audit";
import type { BotService } from "./bots";

/** A "sending" payout whose transfer never landed can be retried after its message expired. */
const RESEND_AFTER_MS = 3 * 60_000;

export function createPayoutService(deps: Deps, bots: BotService) {
	const { db } = deps;

	/** Merchant balances computed inside `tx` (merchant view: positive = owed to them). */
	async function computeBalances(tx: Tx, scope: Scope) {
		// Sequential: queries on one transaction connection can't run concurrently.
		const raw = await balancesOf(tx, scope.mode, scope.organizationId);
		const plan = await planFor(tx, scope.organizationId);
		const pending = owed(raw.merchant_pending);
		const available = owed(raw.merchant_available);
		const inPayout = owed(raw.merchant_payouts);

		// Rolling reserve: a share of what was released in the last `reserveDays` stays put.
		let reserved = 0;
		if (plan.reserveBps > 0 && plan.reserveDays > 0) {
			const since = new Date(
				deps.now().getTime() - plan.reserveDays * 86_400_000,
			);
			const released = await tx.payment.aggregate({
				where: {
					organizationId: scope.organizationId,
					mode: scope.mode,
					settlement: "platform",
					refundedAt: null,
					releasedAt: { not: null },
					// Measured from when money became available, not when the job happened to run.
					availableAt: { gte: since },
				},
				_sum: { netStars: true },
			});
			reserved = Math.floor(
				((released._sum.netStars ?? 0) * plan.reserveBps) / 10_000,
			);
		}
		const withdrawable = Math.max(0, available - reserved);
		return {
			plan,
			pending,
			available,
			inPayout,
			reserved: Math.max(0, Math.min(reserved, available)),
			withdrawable,
		};
	}

	async function reverse(tx: Tx, payout: Payout, reason: string, at: Date) {
		await post(tx, {
			mode: payout.mode,
			type: "payout_reversed",
			organizationId: payout.organizationId,
			payoutId: payout.id,
			description: `Payout ${payout.id} ${reason}`,
			idempotencyKey: `payout_reversed:${payout.id}`,
			at,
			lines: [
				{
					type: "merchant_payouts",
					organizationId: payout.organizationId,
					amount: payout.amountStars,
				},
				{
					type: "platform_fees",
					organizationId: PLATFORM_ORG_ID,
					amount: payout.feeStars,
				},
				{
					type: "merchant_available",
					organizationId: payout.organizationId,
					amount: -(payout.amountStars + payout.feeStars),
				},
			],
		});
	}

	async function settle(tx: Tx, payout: Payout, at: Date) {
		await post(tx, {
			mode: payout.mode,
			type: "payout_paid",
			organizationId: payout.organizationId,
			payoutId: payout.id,
			description: `Payout ${payout.id} sent to ${payout.tonAddress}`,
			idempotencyKey: `payout_paid:${payout.id}`,
			at,
			lines: [
				{
					type: "merchant_payouts",
					organizationId: payout.organizationId,
					amount: payout.amountStars,
				},
				{
					type: "platform_treasury",
					organizationId: PLATFORM_ORG_ID,
					amount: -payout.amountStars,
				},
			],
		});
	}

	/** Moves a payout out of requested/sending. Returns null if it was already finished. */
	async function finish(
		id: string,
		outcome:
			| { status: "paid"; txReference: string }
			| { status: "failed" | "cancelled"; reason: string },
		actor: Actor,
		allowedFrom: Payout["status"][] = ["requested", "sending"],
	) {
		const now = deps.now();
		return db.$transaction(async (tx) => {
			const { count } = await tx.payout.updateMany({
				where: { id, status: { in: allowedFrom } },
				data:
					outcome.status === "paid"
						? {
								status: "paid",
								txReference: outcome.txReference,
								paidAt: now,
								processedById: actor.id,
							}
						: {
								status: outcome.status,
								failureReason: outcome.reason,
								processedById: actor.id,
							},
			});
			if (count === 0) return null;
			const payout = await tx.payout.findUniqueOrThrow({ where: { id } });
			if (outcome.status === "paid") await settle(tx, payout, now);
			else await reverse(tx, payout, outcome.status, now);
			await audit(
				tx,
				{ organizationId: payout.organizationId, mode: payout.mode },
				actor,
				`payout.${outcome.status}`,
				id,
				{
					...outcome,
				},
			);
			return payout;
		});
	}

	return {
		computeBalances,

		/** Everything the merchant's Balance page shows for hosted mode. */
		async balance(scope: Scope): Promise<MerchantBalance> {
			const [own, platform, settings, balances, nextRelease, wallet] =
				await Promise.all([
					bots.find(scope),
					bots.platformBot(scope.mode),
					db.merchantSettings.findUnique({
						where: { organizationId: scope.organizationId },
					}),
					db.$transaction((tx) => computeBalances(tx, scope)),
					db.payment.findFirst({
						where: {
							organizationId: scope.organizationId,
							mode: scope.mode,
							settlement: "platform",
							releasedAt: null,
							refundedAt: null,
						},
						orderBy: { availableAt: "asc" },
						select: { availableAt: true, netStars: true },
					}),
					deps.tonWallet(scope.mode).catch(() => null),
				]);
			const ownActive =
				own && own.status !== "disconnected" && own.status !== "invalid_token";
			return {
				settlement: ownActive ? "direct" : "platform",
				platform_bot: platform ? { username: platform.username } : null,
				plan: serializeFeePlan(balances.plan),
				pending: balances.pending,
				available: balances.available,
				reserved: balances.reserved,
				withdrawable: balances.withdrawable,
				in_payout: balances.inPayout,
				next_release: nextRelease?.availableAt
					? {
							at: nextRelease.availableAt.toISOString(),
							stars: nextRelease.netStars ?? 0,
						}
					: null,
				payout_address: settings?.payoutTonAddress ?? null,
				automatic_payouts: Boolean(wallet),
			};
		},

		async list(scope: Scope, args: PageArgs) {
			const page = pageQuery(args);
			const rows = await db.payout.findMany({
				...page,
				where: {
					...page.where,
					organizationId: scope.organizationId,
					mode: scope.mode,
				},
			});
			return toPage(rows, args.limit, serializePayout);
		},

		async request(scope: Scope, amountStars: number, actor: Actor) {
			const settings = await db.merchantSettings.findUnique({
				where: { organizationId: scope.organizationId },
			});
			const address = settings?.payoutTonAddress;
			if (!address || !isValidTonAddress(address))
				throw errors.payoutAddressMissing();

			const now = deps.now();
			const payout = await db.$transaction(async (tx) => {
				// Serialise payout requests per merchant so two can't spend the same balance.
				await lockAccount(
					tx,
					scope.mode,
					"merchant_available",
					scope.organizationId,
				);
				const balances = await computeBalances(tx, scope);
				const { plan } = balances;
				if (amountStars < plan.minPayoutStars)
					throw errors.payoutBelowMinimum(plan.minPayoutStars);
				const needed = amountStars + plan.payoutFeeStars;
				if (needed > balances.withdrawable)
					throw errors.insufficientBalance(balances.withdrawable, needed);

				const created = await tx.payout.create({
					data: {
						id: newId("payout", now.getTime()),
						organizationId: scope.organizationId,
						mode: scope.mode,
						amountStars,
						feeStars: plan.payoutFeeStars,
						tonAddress: address,
						requestedById: actor.id,
						createdAt: now,
					},
				});
				await post(tx, {
					mode: scope.mode,
					type: "payout_request",
					organizationId: scope.organizationId,
					payoutId: created.id,
					description: `Payout ${created.id} requested`,
					idempotencyKey: `payout_request:${created.id}`,
					at: now,
					lines: [
						{
							type: "merchant_available",
							organizationId: scope.organizationId,
							amount: needed,
						},
						{
							type: "merchant_payouts",
							organizationId: scope.organizationId,
							amount: -amountStars,
						},
						{
							type: "platform_fees",
							organizationId: PLATFORM_ORG_ID,
							amount: -plan.payoutFeeStars,
						},
					],
				});
				await audit(tx, scope, actor, "payout.request", created.id, {
					amount: amountStars,
				});
				return created;
			});
			return serializePayout(payout);
		},

		async cancel(scope: Scope, id: string, actor: Actor) {
			const payout = await db.payout.findFirst({
				where: { id, organizationId: scope.organizationId, mode: scope.mode },
			});
			if (!payout) throw errors.notFound("payout", id);
			// Only before StarPay starts sending it.
			const done = await finish(
				id,
				{ status: "cancelled", reason: "cancelled by merchant" },
				actor,
				["requested"],
			);
			if (!done) throw errors.payoutNotAllowed(id, payout.status);
			return serializePayout(done);
		},

		/** Ledger history as it affected this merchant. */
		async ledger(scope: Scope, args: PageArgs) {
			const page = pageQuery(args);
			const rows = await db.ledgerTransaction.findMany({
				...page,
				where: {
					...page.where,
					organizationId: scope.organizationId,
					mode: scope.mode,
				},
				include: { entries: { select: { accountId: true, amount: true } } },
			});
			const ids = {
				pending: accountId(
					scope.mode,
					"merchant_pending",
					scope.organizationId,
				),
				available: accountId(
					scope.mode,
					"merchant_available",
					scope.organizationId,
				),
				payouts: accountId(
					scope.mode,
					"merchant_payouts",
					scope.organizationId,
				),
			};
			// Liability accounts: a credit (negative) increases what the merchant is owed.
			const change = (
				entries: { accountId: string; amount: number }[],
				id: string,
			) =>
				owed(
					entries
						.filter((entry) => entry.accountId === id)
						.reduce((sum, entry) => sum + entry.amount, 0),
				);
			return toPage(
				rows,
				args.limit,
				(row): MerchantLedgerEntry => ({
					id: row.id,
					type: row.type,
					description: row.description,
					pending_change: change(row.entries, ids.pending),
					available_change: change(row.entries, ids.available),
					payout_change: change(row.entries, ids.payouts),
					payment_id: row.paymentId,
					payout_id: row.payoutId,
					created_at: row.createdAt.toISOString(),
				}),
			);
		},

		// ── Platform operations ──

		markPaid: (id: string, txReference: string, actor: Actor) =>
			finish(id, { status: "paid", txReference }, actor),
		markFailed: (id: string, reason: string, actor: Actor) =>
			finish(id, { status: "failed", reason }, actor),

		/**
		 * Sends the oldest requested payout for `mode` from the hot wallet, one at a
		 * time. Replay-safe: the seqno is saved before sending, and a transfer that
		 * may or may not have landed is resolved from the wallet's seqno instead of
		 * being sent again blindly.
		 */
		async processNext(
			mode: Mode,
		): Promise<"idle" | "sent" | "waiting" | "manual"> {
			const wallet = await deps.tonWallet(mode);
			if (!wallet) return "manual";
			const system: Actor = { type: "system", id: "system" };

			// Resolve an in-flight transfer before starting another.
			const inFlight = await db.payout.findFirst({
				where: { mode, status: "sending" },
				orderBy: { createdAt: "asc" },
			});
			if (inFlight) {
				if (inFlight.walletSeqno === null) {
					await finish(
						inFlight.id,
						{ status: "failed", reason: "interrupted before sending" },
						system,
					);
					return "idle";
				}
				const seqno = await wallet.getSeqno();
				if (seqno > inFlight.walletSeqno) {
					await finish(
						inFlight.id,
						{ status: "paid", txReference: `seqno:${inFlight.walletSeqno}` },
						system,
					);
					return "sent";
				}
				const sentAgo =
					deps.now().getTime() - (inFlight.sentAt?.getTime() ?? 0);
				if (sentAgo < RESEND_AFTER_MS) return "waiting";
				// The earlier message expired unaccepted; the same seqno is safe to reuse.
				await db.payout.update({
					where: { id: inFlight.id },
					data: { sentAt: deps.now() },
				});
				await wallet.transfer({
					seqno: inFlight.walletSeqno,
					to: inFlight.tonAddress,
					amountNano: inFlight.tonAmountNano ?? 0n,
					comment: `StarPay payout ${inFlight.id}`,
				});
				return "waiting";
			}

			const next = await db.payout.findFirst({
				where: { mode, status: "requested" },
				orderBy: { createdAt: "asc" },
			});
			if (!next) return "idle";
			const starUsd = deps.config.starUsdRate ?? DEFAULT_STAR_USD_RATE;
			const tonUsd = await deps.rates.tonUsd();
			const amountNano = starsToNanoTon(next.amountStars, starUsd, tonUsd);
			const seqno = await wallet.getSeqno();
			const { count } = await db.payout.updateMany({
				where: { id: next.id, status: "requested" },
				data: {
					status: "sending",
					walletSeqno: seqno,
					starUsdRate: starUsd,
					tonUsdRate: tonUsd,
					tonAmountNano: amountNano,
					sentAt: deps.now(),
				},
			});
			if (count === 0) return "idle"; // cancelled or claimed meanwhile
			await wallet.transfer({
				seqno,
				to: next.tonAddress,
				amountNano,
				comment: `StarPay payout ${next.id}`,
			});
			return "waiting";
		},
	};
}

export type PayoutService = ReturnType<typeof createPayoutService>;
