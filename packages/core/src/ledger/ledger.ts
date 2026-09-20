// Double-entry ledger in whole Stars. Every transaction's lines sum to zero and
// entries are append-only (both also enforced by database triggers). Balances are
// never stored: they are always SUM(entries) per account.
import type { LedgerAccountType, Mode, Tx } from "@starpay/db";

import { newId } from "../ids";
import { toJson } from "../serializers";

export type LedgerLine = {
	type: LedgerAccountType;
	/** Merchant organization, or PLATFORM_ORG_ID. */
	organizationId: string;
	/** Signed Stars: positive = debit, negative = credit. */
	amount: number;
};

export type PostInput = {
	mode: Mode;
	type: string;
	description: string;
	/** Posting twice with the same key is a no-op. */
	idempotencyKey: string;
	organizationId?: string | null;
	paymentId?: string;
	payoutId?: string;
	metadata?: Record<string, unknown>;
	lines: LedgerLine[];
	at: Date;
};

/**
 * A liability or revenue balance from the owner's side: credits (negative
 * signed sums) become positive amounts. Avoids -0 for empty accounts.
 */
export function owed(signedBalance: number): number {
	return signedBalance === 0 ? 0 : -signedBalance;
}

/** Deterministic account IDs: no lookup needed to post. */
export function accountId(
	mode: Mode,
	type: LedgerAccountType,
	organizationId: string,
) {
	return `la_${mode}_${type}_${organizationId}`;
}

export class UnbalancedTransactionError extends Error {
	constructor(sum: number) {
		super(`Ledger transaction does not balance (sum ${sum})`);
	}
}

/** Posts a transaction inside the caller's DB transaction. */
export async function post(
	tx: Tx,
	input: PostInput,
): Promise<{ id: string; created: boolean }> {
	const lines = input.lines.filter((line) => line.amount !== 0);
	for (const line of lines) {
		if (!Number.isSafeInteger(line.amount))
			throw new Error(`Ledger amounts must be whole Stars: ${line.amount}`);
	}
	const sum = lines.reduce((total, line) => total + line.amount, 0);
	if (sum !== 0) throw new UnbalancedTransactionError(sum);

	const existing = await tx.ledgerTransaction.findUnique({
		where: { idempotencyKey: input.idempotencyKey },
		select: { id: true },
	});
	if (existing) return { id: existing.id, created: false };
	if (lines.length === 0) return { id: "", created: false };

	await tx.ledgerAccount.createMany({
		data: lines.map((line) => ({
			id: accountId(input.mode, line.type, line.organizationId),
			mode: input.mode,
			type: line.type,
			organizationId: line.organizationId,
		})),
		skipDuplicates: true,
	});

	const created = await tx.ledgerTransaction.create({
		data: {
			id: newId("ledgerTransaction", input.at.getTime()),
			mode: input.mode,
			type: input.type,
			organizationId: input.organizationId ?? null,
			paymentId: input.paymentId,
			payoutId: input.payoutId,
			description: input.description,
			idempotencyKey: input.idempotencyKey,
			metadata: toJson(input.metadata ?? {}),
			createdAt: input.at,
			entries: {
				createMany: {
					data: lines.map((line) => ({
						accountId: accountId(input.mode, line.type, line.organizationId),
						amount: line.amount,
						createdAt: input.at,
					})),
				},
			},
		},
		select: { id: true },
	});
	return { id: created.id, created: true };
}

export type Balances = Record<LedgerAccountType, number>;

const EMPTY: Balances = {
	platform_telegram: 0,
	platform_treasury: 0,
	platform_fees: 0,
	merchant_pending: 0,
	merchant_available: 0,
	merchant_payouts: 0,
};

/** Raw signed balances (debits positive) of one owner's accounts. */
export async function balancesOf(
	tx: Tx,
	mode: Mode,
	organizationId: string,
): Promise<Balances> {
	const rows = await tx.$queryRaw<
		{ type: LedgerAccountType; balance: bigint }[]
	>`
		SELECT a.type, COALESCE(SUM(e.amount), 0)::bigint AS balance
		FROM ledger_account a
		LEFT JOIN ledger_entry e ON e."accountId" = a.id
		WHERE a.mode = ${mode}::"Mode" AND a."organizationId" = ${organizationId}
		GROUP BY a.type`;
	const balances = { ...EMPTY };
	for (const row of rows) balances[row.type] = Number(row.balance);
	return balances;
}

/** Signed totals per account type across every owner (for platform reporting). */
export async function totalsByType(tx: Tx, mode: Mode): Promise<Balances> {
	const rows = await tx.$queryRaw<
		{ type: LedgerAccountType; balance: bigint }[]
	>`
		SELECT a.type, COALESCE(SUM(e.amount), 0)::bigint AS balance
		FROM ledger_account a
		LEFT JOIN ledger_entry e ON e."accountId" = a.id
		WHERE a.mode = ${mode}::"Mode"
		GROUP BY a.type`;
	const balances = { ...EMPTY };
	for (const row of rows) balances[row.type] = Number(row.balance);
	return balances;
}

/**
 * Locks an account row until the surrounding transaction ends, serialising
 * balance checks (e.g. two payout requests racing for the same funds).
 */
export async function lockAccount(
	tx: Tx,
	mode: Mode,
	type: LedgerAccountType,
	organizationId: string,
) {
	const id = accountId(mode, type, organizationId);
	await tx.ledgerAccount.createMany({
		data: [{ id, mode, type, organizationId }],
		skipDuplicates: true,
	});
	await tx.$queryRaw`SELECT id FROM ledger_account WHERE id = ${id} FOR UPDATE`;
}
