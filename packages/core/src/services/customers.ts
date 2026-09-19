import type { Prisma } from "@starpay/db";

import type { Deps, Scope } from "../deps";
import { type PageArgs, pageQuery, toPage } from "../pagination";
import {
	serializeCustomer,
	serializeSubscription,
	subscriptionInclude,
} from "../serializers";

export function createCustomerService(deps: Deps) {
	const { db } = deps;

	return {
		/** Top spenders first. */
		async list(
			scope: Scope,
			input: { q?: string; limit: number; offset: number },
		) {
			const q = input.q?.trim().replace(/^@/, "");
			const where: Prisma.CustomerWhereInput = {
				organizationId: scope.organizationId,
				mode: scope.mode,
				...(q
					? /^\d+$/.test(q)
						? { telegramUserId: BigInt(q) }
						: { username: { contains: q, mode: "insensitive" } }
					: {}),
			};
			const [rows, total] = await Promise.all([
				db.customer.findMany({
					where,
					orderBy: [{ totalSpent: "desc" }, { id: "desc" }],
					skip: input.offset,
					take: input.limit,
				}),
				db.customer.count({ where }),
			]);
			return { data: rows.map(serializeCustomer), total };
		},
	};
}

export function createSubscriptionService(deps: Deps) {
	const { db } = deps;

	return {
		async stats(scope: Scope) {
			const inScope = {
				organizationId: scope.organizationId,
				mode: scope.mode,
			};
			const [active, cancelled] = await Promise.all([
				db.subscription.findMany({
					where: { ...inScope, status: "active" },
					select: { product: { select: { priceStars: true } } },
				}),
				db.subscription.count({
					where: {
						...inScope,
						status: "cancelled",
						currentPeriodEnd: { gt: deps.now() },
					},
				}),
			]);
			return {
				active: active.length,
				cancelled,
				monthly_stars: active.reduce(
					(sum, row) => sum + row.product.priceStars,
					0,
				),
			};
		},

		async list(
			scope: Scope,
			args: PageArgs & { status?: "active" | "cancelled" | "expired" },
		) {
			const page = pageQuery(args);
			const rows = await db.subscription.findMany({
				...page,
				where: {
					...page.where,
					organizationId: scope.organizationId,
					mode: scope.mode,
					status: args.status,
				},
				include: subscriptionInclude,
			});
			return toPage(rows, args.limit, serializeSubscription);
		},
	};
}
