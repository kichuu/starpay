/**
 * Rough USD value of Stars for display only. Telegram pays developers about
 * $0.013 per Star; the real rate is set at withdrawal on Fragment.
 */
export const STAR_USD_ESTIMATE = 0.013;

const number = new Intl.NumberFormat("en-US");

export function formatStars(stars: number): string {
	return number.format(stars);
}

export function formatUsd(stars: number): string {
	const usd = stars * STAR_USD_ESTIMATE;
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: usd < 100 ? 2 : 0,
	}).format(usd);
}

export function formatCompact(stars: number): string {
	return stars >= 1000
		? `${(stars / 1000).toFixed(stars >= 10_000 ? 0 : 1)}k`
		: String(stars);
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function timeAgo(
	iso: string | null | undefined,
	now = Date.now(),
): string {
	if (!iso) return "never";
	const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
	const abs = Math.abs(seconds);
	if (abs < 45)
		return abs < 5 ? "just now" : relative.format(seconds, "second");
	if (abs < 45 * 60) return relative.format(Math.round(seconds / 60), "minute");
	if (abs < 22 * 3600)
		return relative.format(Math.round(seconds / 3600), "hour");
	return relative.format(Math.round(seconds / 86_400), "day");
}

/** "14:22 · today", "09:31 · yesterday" or "12 Sep 14:22". */
export function formatWhen(iso: string, now = new Date()): string {
	const date = new Date(iso);
	const time = date.toLocaleTimeString("en-GB", {
		hour: "2-digit",
		minute: "2-digit",
	});
	const dayDiff = Math.round(
		(new Date(now.toDateString()).getTime() -
			new Date(date.toDateString()).getTime()) /
			86_400_000,
	);
	if (dayDiff === 0) return `${time} · today`;
	if (dayDiff === 1) return `${time} · yesterday`;
	return `${date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} ${time}`;
}

export function formatDate(iso: string): string {
	return new Date(iso).toLocaleDateString("en-GB", {
		day: "2-digit",
		month: "short",
		year: "numeric",
	});
}

export function initials(name: string | null | undefined): string {
	const clean = (name ?? "").replace(/^@/, "").trim();
	if (!clean) return "?";
	const parts = clean.split(/[\s._-]+/).filter(Boolean);
	return (
		(parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")
	).toUpperCase();
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Something went wrong";
}
