// Ledger postings for hosted (platform-settled) payments.
//
//   payment:  platform_telegram +gross | merchant_pending −net | platform_fees −fee
//   release:  merchant_pending +net    | merchant_available −net          (after the hold period)
//   refund:   platform_telegram −gross | platform_fees +fee | pending/available +net
import type { FeePlan, Payment, Tx } from "@starpay/db";

import type { Deps } from "../deps";
import { computeFee } from "../ledger/fees";
import { post } from "../ledger/ledger";
import { PLATFORM_ORG_ID } from "../platform";

export type PlatformTerms = {
	feeStars: number;
	netStars: number;
	availableAt: Date;
	feePlanId: string;
};

export function termsFor(
	amountStars: number,
	plan: FeePlan,
	paidAt: Date,
): PlatformTerms {
	const feeStars = computeFee(amountStars, plan);
	return {
		feeStars,
		netStars: amountStars - feeStars,
		availableAt: new Date(paidAt.getTime() + plan.holdDays * 86_400_000),
		feePlanId: plan.id,
	};
}

/** Books a hosted payment. Call inside the transaction that creates the Payment. */
export async function bookPayment(tx: Tx, payment: Payment, at: Date) {
	const net = payment.netStars ?? payment.amountStars - payment.feeStars;
	await post(tx, {
		mode: payment.mode,
		type: "payment",
		organizationId: payment.organizationId,
		paymentId: payment.id,
		description: `Payment ${payment.telegramChargeId}`,
		idempotencyKey: `payment:${payment.id}`,
		at,
		lines: [
			{
				type: "platform_telegram",
				organizationId: PLATFORM_ORG_ID,
				amount: payment.amountStars,
			},
			{
				type: "merchant_pending",
				organizationId: payment.organizationId,
				amount: -net,
			},
			{
				type: "platform_fees",
				organizationId: PLATFORM_ORG_ID,
				amount: -payment.feeStars,
			},
		],
	});
}

/**
 * Reverses a hosted payment in full (the fee is returned too, so the books
 * mirror the original sale). Call inside the transaction that marks it refunded.
 * The merchant's balance may go negative if the money was already paid out.
 */
export async function bookRefund(tx: Tx, payment: Payment, at: Date) {
	const net = payment.netStars ?? payment.amountStars - payment.feeStars;
	await post(tx, {
		mode: payment.mode,
		type: "refund",
		organizationId: payment.organizationId,
		paymentId: payment.id,
		description: `Refund ${payment.telegramChargeId}`,
		idempotencyKey: `refund:${payment.id}`,
		at,
		lines: [
			{
				type: "platform_telegram",
				organizationId: PLATFORM_ORG_ID,
				amount: -payment.amountStars,
			},
			{
				type: "platform_fees",
				organizationId: PLATFORM_ORG_ID,
				amount: payment.feeStars,
			},
			{
				type: payment.releasedAt ? "merchant_available" : "merchant_pending",
				organizationId: payment.organizationId,
				amount: net,
			},
		],
	});
}

export function createSettlementService(deps: Deps) {
	const { db } = deps;

	return {
		/** Moves hosted payments whose hold period has passed from pending to available. */
		async releaseDue(limit = 200): Promise<number> {
			const now = deps.now();
			const due = await db.payment.findMany({
				where: {
					settlement: "platform",
					releasedAt: null,
					refundedAt: null,
					availableAt: { lte: now },
				},
				orderBy: { availableAt: "asc" },
				take: limit,
			});
			let released = 0;
			for (const payment of due) {
				const done = await db.$transaction(async (tx) => {
					// Conditional update: loses cleanly to a concurrent refund or release.
					const { count } = await tx.payment.updateMany({
						where: { id: payment.id, releasedAt: null, refundedAt: null },
						data: { releasedAt: now },
					});
					if (count === 0) return false;
					const net =
						payment.netStars ?? payment.amountStars - payment.feeStars;
					await post(tx, {
						mode: payment.mode,
						type: "release",
						organizationId: payment.organizationId,
						paymentId: payment.id,
						description: `Hold ended for ${payment.telegramChargeId}`,
						idempotencyKey: `release:${payment.id}`,
						at: now,
						lines: [
							{
								type: "merchant_pending",
								organizationId: payment.organizationId,
								amount: net,
							},
							{
								type: "merchant_available",
								organizationId: payment.organizationId,
								amount: -net,
							},
						],
					});
					return true;
				});
				if (done) released++;
			}
			return released;
		},
	};
}
