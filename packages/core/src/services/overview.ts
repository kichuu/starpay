import type { Deps, Scope } from "../deps";

export function createOverviewService(deps: Deps) {
	const { db } = deps;
	const inScope = (scope: Scope) => ({
		organizationId: scope.organizationId,
		mode: scope.mode,
	});

	return {
		async onboarding(scope: Scope) {
			const [bot, products, paid, keys] = await Promise.all([
				db.bot.findUnique({ where: { organizationId_mode: inScope(scope) } }),
				db.product.count({ where: inScope(scope) }),
				db.order.count({
					where: { ...inScope(scope), status: { in: ["paid", "refunded"] } },
				}),
				db.apiKey.count({ where: { ...inScope(scope), revokedAt: null } }),
			]);
			return {
				bot_connected: Boolean(bot && bot.status !== "disconnected"),
				has_product: products > 0,
				has_paid_order: paid > 0,
				has_api_key: keys > 0,
			};
		},
	};
}
