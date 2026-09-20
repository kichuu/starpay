import type { FeePlan, Tx } from "@starpay/db";

/** Commission on one payment: percentage (round half up) plus a flat part, never above the amount. */
export function computeFee(
	amountStars: number,
	plan: Pick<FeePlan, "percentBps" | "fixedStars">,
): number {
	const percentPart = Math.floor(
		(amountStars * plan.percentBps + 5000) / 10_000,
	);
	return Math.min(amountStars, percentPart + plan.fixedStars);
}

/** The merchant's assigned plan, else the default plan. */
export async function planFor(
	tx: Tx,
	organizationId: string,
): Promise<FeePlan> {
	const settings = await tx.merchantSettings.findUnique({
		where: { organizationId },
		select: { feePlan: true },
	});
	if (settings?.feePlan) return settings.feePlan;
	const plan = await tx.feePlan.findFirst({ where: { isDefault: true } });
	if (!plan) throw new Error("No default fee plan configured");
	return plan;
}

export type PayoutFee = {
	/** TON network gas, priced in Stars at the current rate. */
	gas: number;
	/** Percentage of the requested amount. */
	percent: number;
	/** Flat part. */
	flat: number;
	total: number;
	/** amount - total: converted to TON and sent. */
	net: number;
};

/**
 * Payout fees come out of the requested amount, so a merchant cashing out 100
 * receives 100 minus gas and commission. Each part rounds up, so StarPay never
 * under-collects the gas it pays.
 */
export function computePayoutFee(
	amountStars: number,
	plan: Pick<FeePlan, "payoutFeeBps" | "payoutFeeStars" | "payoutGasNano">,
	rates: { tonUsd: number; starUsd: number },
): PayoutFee {
	const gasTon = Number(plan.payoutGasNano) / 1e9;
	const gas = Math.ceil((gasTon * rates.tonUsd) / rates.starUsd);
	const percent = Math.ceil((amountStars * plan.payoutFeeBps) / 10_000);
	const flat = plan.payoutFeeStars;
	const total = gas + percent + flat;
	return { gas, percent, flat, total, net: amountStars - total };
}
