import type { OverviewRange, OverviewResult } from "@starpay/contracts";

import type { Deps, Scope } from "../deps";
import { orderInclude, serializeOrder } from "../serializers";

/** Days in each range; "today" is the current local day. */
const RANGE_DAYS: Record<OverviewRange, number> = {
	today: 1,
	"7d": 7,
	"30d": 30,
};

export function createAnalyticsService(deps: Deps) {
	const { db } = deps;

	return {
		/**
		 * Dashboard overview. Days are the viewer's local days (`tz`), so "today"
		 * starts at their midnight. Revenue is net: refunded payments are excluded.
		 */
		async overview(
			scope: Scope,
			range: OverviewRange,
			tz: string,
		): Promise<OverviewResult> {
			const days = RANGE_DAYS[range];
			const now = deps.now();
			const org = scope.organizationId;
			const mode = scope.mode;

			// Local calendar date of a UTC timestamp column (timestamp(3) stores UTC).
			// The range covers local days [today - (days-1), today]; the previous
			// period is the same number of days immediately before it.
			const [series, totals, conversion, deliveries, recent] =
				await Promise.all([
					range === "today"
						? db.$queryRaw<{ label: string; stars: number }[]>`
						SELECT lpad((s.slot * 4)::text, 2, '0') AS label,
						       COALESCE(SUM(p."amountStars"), 0)::int AS stars
						FROM generate_series(0, 5) AS s(slot)
						LEFT JOIN payment p
						  ON p."organizationId" = ${org} AND p.mode = ${mode}::"Mode" AND p."refundedAt" IS NULL
						 AND (p."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date = (${now}::timestamptz AT TIME ZONE ${tz})::date
						 AND floor(extract(hour FROM p."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}) / 4) = s.slot
						GROUP BY s.slot ORDER BY s.slot`
						: db.$queryRaw<{ label: string; stars: number }[]>`
						WITH today AS (SELECT (${now}::timestamptz AT TIME ZONE ${tz})::date AS d)
						SELECT to_char(day, 'YYYY-MM-DD') AS label,
						       COALESCE(SUM(p."amountStars"), 0)::int AS stars
						FROM today,
						     generate_series((today.d - ${days - 1}::int)::timestamp, today.d::timestamp, interval '1 day') AS g(day)
						LEFT JOIN payment p
						  ON p."organizationId" = ${org} AND p.mode = ${mode}::"Mode" AND p."refundedAt" IS NULL
						 AND (p."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date = g.day::date
						GROUP BY day ORDER BY day`,
					db.$queryRaw<{ current: number; previous: number; count: number }[]>`
					WITH today AS (SELECT (${now}::timestamptz AT TIME ZONE ${tz})::date AS d),
					     local AS (
					       SELECT p."amountStars" AS amount,
					              (p."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date AS day
					       FROM payment p
					       WHERE p."organizationId" = ${org} AND p.mode = ${mode}::"Mode" AND p."refundedAt" IS NULL
					         AND p."createdAt" >= ${now}::timestamptz - make_interval(days => ${2 * days + 1}::int)
					     )
					SELECT COALESCE(SUM(amount) FILTER (WHERE day > today.d - ${days}::int), 0)::int AS current,
					       COALESCE(SUM(amount) FILTER (WHERE day <= today.d - ${days}::int
					                                     AND day > today.d - ${2 * days}::int), 0)::int AS previous,
					       COUNT(*) FILTER (WHERE day > today.d - ${days}::int)::int AS count
					FROM local, today`,
					db.$queryRaw<{ created: number; paid: number }[]>`
					WITH today AS (SELECT (${now}::timestamptz AT TIME ZONE ${tz})::date AS d)
					SELECT COUNT(*)::int AS created,
					       COUNT(*) FILTER (WHERE o.status IN ('paid', 'refunded'))::int AS paid
					FROM "order" o, today
					WHERE o."organizationId" = ${org} AND o.mode = ${mode}::"Mode"
					  AND o."createdAt" >= ${now}::timestamptz - make_interval(days => ${days + 1}::int)
					  AND (o."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date > today.d - ${days}::int`,
					db.webhookDelivery.groupBy({
						by: ["status"],
						where: {
							status: { in: ["pending", "failed"] },
							event: { organizationId: org, mode },
						},
						_count: { _all: true },
					}),
					db.order.findMany({
						where: { organizationId: org, mode },
						orderBy: { id: "desc" },
						take: 5,
						include: orderInclude,
					}),
				]);

			const total = totals[0] ?? { current: 0, previous: 0, count: 0 };
			const deliveryCount = (status: string) =>
				deliveries.find((row) => row.status === status)?._count._all ?? 0;
			return {
				range,
				revenue: { stars: total.current, previous: total.previous },
				payments: {
					count: total.count,
					average:
						total.count > 0 ? Math.round(total.current / total.count) : 0,
				},
				conversion: conversion[0] ?? { created: 0, paid: 0 },
				deliveries: {
					failed: deliveryCount("failed"),
					pending: deliveryCount("pending"),
				},
				series,
				recent: recent.map(serializeOrder),
			};
		},
	};
}
