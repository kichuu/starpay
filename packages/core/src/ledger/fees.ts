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
