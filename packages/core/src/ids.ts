import { randomBytes } from "node:crypto";

// Crockford base32 keeps IDs lexicographically sortable by creation time,
// so cursor pagination can page on `id` alone (ULID layout: 10 time + 16 random).
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function ulid(now: number): string {
	let time = "";
	let t = now;
	for (let i = 0; i < 10; i++) {
		time = CROCKFORD[t % 32] + time;
		t = Math.floor(t / 32);
	}
	let random = "";
	for (const byte of randomBytes(16)) random += CROCKFORD[byte % 32];
	return time + random;
}

export const ID_PREFIX = {
	bot: "bot",
	apiKey: "key",
	product: "prod",
	customer: "cus",
	order: "ord",
	payment: "pay",
	subscription: "sub",
	event: "evt",
	endpoint: "we",
	delivery: "whd",
} as const;

export type IdKind = keyof typeof ID_PREFIX;

export function newId(kind: IdKind, now: number = Date.now()): string {
	return `${ID_PREFIX[kind]}_${ulid(now)}`;
}
