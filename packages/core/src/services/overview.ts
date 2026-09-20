import type { Deps, Scope } from "../deps";
import { PLATFORM_ORG_ID } from "../platform";

export function createOverviewService(deps: Deps) {
	const { db } = deps;
	const inScope = (scope: Scope) => ({
		organizationId: scope.organizationId,
		mode: scope.mode,
	});

	return {
		async onboarding(scope: Scope) {
			const [bot, platformBot, products, paid, keys] = await Promise.all([
				db.bot.findUnique({ where: { organizationId_mode: inScope(scope) } }),
				// Hosted mode: StarPay's bot takes payments for merchants without their own.
				db.bot.findFirst({
					where: {
						organizationId: PLATFORM_ORG_ID,
						mode: scope.mode,
						status: { in: ["active", "webhook_error"] },
					},
					select: { id: true },
				}),
				db.product.count({ where: inScope(scope) }),
				db.order.count({
					where: { ...inScope(scope), status: { in: ["paid", "refunded"] } },
				}),
				db.apiKey.count({ where: { ...inScope(scope), revokedAt: null } }),
			]);
			return {
				bot_connected: Boolean(
					(bot && bot.status !== "disconnected") || platformBot,
				),
				has_product: products > 0,
				has_paid_order: paid > 0,
				has_api_key: keys > 0,
			};
		},
	};
}
