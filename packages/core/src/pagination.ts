/** Cursor page over rows whose `id` sorts by creation time (see ids.ts). */
export type PageArgs = { limit: number; starting_after?: string };

export function pageQuery({ limit, starting_after }: PageArgs) {
	return {
		where: starting_after ? { id: { lt: starting_after } } : {},
		orderBy: { id: "desc" as const },
		take: limit + 1,
	};
}

export function toPage<Row, Out>(
	rows: Row[],
	limit: number,
	serialize: (row: Row) => Out,
) {
	return {
		object: "list" as const,
		data: rows.slice(0, limit).map(serialize),
		has_more: rows.length > limit,
	};
}
