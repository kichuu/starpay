// Hosted mode: ledger balances, payouts and fee plans (merchant dashboard + platform admin).
import { oc } from "@orpc/contract";
import { z } from "zod";

import {
	ListInput,
	listOf,
	Mode,
	prefixedId,
	Stars,
	Timestamp,
} from "./common";

export const FeePlanView = z.object({
	id: z.string(),
	name: z.string(),
	percent_bps: z.int().min(0).max(10_000),
	fixed_stars: z.int().min(0),
	/** Payout fee: percentage + flat Stars + network gas, all taken out of the amount. */
	payout_fee_bps: z.int().min(0).max(10_000),
	payout_fee_stars: z.int().min(0),
	/** Network gas reserved per payout, in TON. */
	payout_gas_ton: z.string(),
	min_payout_stars: z.int().min(1),
	hold_days: z.int().min(0).max(365),
	reserve_bps: z.int().min(0).max(10_000),
	reserve_days: z.int().min(0).max(365),
	is_default: z.boolean(),
});
export type FeePlanView = z.infer<typeof FeePlanView>;

export const PayoutStatus = z.enum([
	"requested",
	"sending",
	"paid",
	"failed",
	"cancelled",
]);

export const PayoutObject = z.object({
	id: prefixedId("po"),
	object: z.literal("payout"),
	livemode: z.boolean(),
	status: PayoutStatus,
	/** Requested amount, taken from the merchant's balance. */
	amount: Stars,
	fee: Stars,
	/** amount - fee: what is converted to TON and sent. */
	net: Stars,
	fee_breakdown: z
		.object({ gas: z.int(), percent: z.int(), flat: z.int() })
		.partial(),
	ton_address: z.string(),
	/** Decimal TON actually sent, once known. */
	ton_amount: z.string().nullable(),
	tx_reference: z.string().nullable(),
	failure_reason: z.string().nullable(),
	created_at: Timestamp,
	paid_at: Timestamp.nullable(),
});
export type PayoutObject = z.infer<typeof PayoutObject>;

/** Merchant balances, from the merchant's point of view (positive = StarPay owes them). */
export const MerchantBalance = z.object({
	/** "platform" when this mode's payments go through StarPay's bot. */
	settlement: z.enum(["platform", "direct"]),
	platform_bot: z.object({ username: z.string() }).nullable(),
	plan: FeePlanView,
	/** Inside the hold period. */
	pending: z.int(),
	/** Released; can be negative after refunds of paid-out money. */
	available: z.int(),
	/** Held back from `available` by the rolling reserve. */
	reserved: Stars,
	/** What a payout can take right now (before the payout fee). */
	withdrawable: Stars,
	/** Requested payouts not yet sent. */
	in_payout: Stars,
	next_release: z.object({ at: Timestamp, stars: Stars }).nullable(),
	payout_address: z.string().nullable(),
	/** StarPay sends TON automatically (otherwise payouts are processed by the StarPay team). */
	automatic_payouts: z.boolean(),
});
export type MerchantBalance = z.infer<typeof MerchantBalance>;

/** One ledger transaction as it affected the merchant (positive = in their favour). */
export const MerchantLedgerEntry = z.object({
	id: z.string(),
	type: z.string(),
	description: z.string(),
	pending_change: z.int(),
	available_change: z.int(),
	payout_change: z.int(),
	payment_id: z.string().nullable(),
	payout_id: z.string().nullable(),
	created_at: Timestamp,
});
export type MerchantLedgerEntry = z.infer<typeof MerchantLedgerEntry>;

export const PayoutQuote = z.object({
	amount: Stars,
	gas: z.int(),
	percent: z.int(),
	flat: z.int(),
	total: z.int(),
	net: z.int(),
});

export const payoutsContract = {
	balance: oc.output(MerchantBalance),
	/** Live pricing for an amount before the merchant confirms. */
	quote: oc.input(z.object({ amount: Stars.min(1) })).output(PayoutQuote),
	list: oc.input(ListInput).output(listOf(PayoutObject)),
	request: oc.input(z.object({ amount: Stars.min(1) })).output(PayoutObject),
	cancel: oc.input(z.object({ id: prefixedId("po") })).output(PayoutObject),
	ledger: oc.input(ListInput).output(listOf(MerchantLedgerEntry)),
};

// ── Platform admin ──

const FeePlanInput = FeePlanView.omit({ id: true, is_default: true }).extend({
	name: z.string().min(1).max(64),
});

export const AdminOverview = z.object({
	mode: Mode,
	platform_bot: z
		.object({ id: z.string(), username: z.string(), status: z.string() })
		.nullable(),
	/** Signed ledger balances of StarPay's own accounts. */
	platform: z.object({
		telegram_ledger: z.int(),
		/** Live from Telegram's getMyStarBalance; null if unavailable. */
		telegram_actual: z.int().nullable(),
		treasury: z.int(),
		fees_earned: z.int(),
	}),
	/** What StarPay owes merchants, summed. */
	liabilities: z.object({
		pending: z.int(),
		available: z.int(),
		in_payout: z.int(),
	}),
	payouts_waiting: z.int(),
	automatic_payouts: z.boolean(),
	wallet_address: z.string().nullable(),
	/** Decimal TON in the hot wallet; null when unset or unreachable. */
	wallet_balance_ton: z.string().nullable(),
});
export type AdminOverview = z.infer<typeof AdminOverview>;

export const AdminPayout = PayoutObject.extend({
	organization: z.object({ id: z.string(), name: z.string() }),
});

export const AdminMerchant = z.object({
	id: z.string(),
	name: z.string(),
	fee_plan_id: z.string().nullable(),
	pending: z.int(),
	available: z.int(),
	in_payout: z.int(),
});

export const adminContract = {
	overview: oc.input(z.object({ mode: Mode })).output(AdminOverview),
	payouts: {
		list: oc
			.input(ListInput.extend({ mode: Mode, status: PayoutStatus.optional() }))
			.output(listOf(AdminPayout)),
		markPaid: oc
			.input(
				z.object({
					id: prefixedId("po"),
					tx_reference: z.string().min(3).max(200),
				}),
			)
			.output(PayoutObject),
		markFailed: oc
			.input(
				z.object({ id: prefixedId("po"), reason: z.string().min(3).max(500) }),
			)
			.output(PayoutObject),
	},
	/** Record Stars withdrawn from the platform bot on Fragment. */
	recordWithdrawal: oc
		.input(
			z.object({
				mode: Mode,
				stars: Stars.min(1),
				ton_received: z.string().max(40).optional(),
				note: z.string().max(500).optional(),
			}),
		)
		.output(z.object({ ok: z.literal(true) })),
	feePlans: {
		list: oc.output(z.array(FeePlanView)),
		create: oc.input(FeePlanInput).output(FeePlanView),
		update: oc
			.input(FeePlanInput.partial().extend({ id: z.string() }))
			.output(FeePlanView),
		setDefault: oc.input(z.object({ id: z.string() })).output(FeePlanView),
	},
	merchants: {
		list: oc.input(z.object({ mode: Mode })).output(z.array(AdminMerchant)),
		setFeePlan: oc
			.input(
				z.object({
					organization_id: z.string(),
					fee_plan_id: z.string().nullable(),
				}),
			)
			.output(z.object({ ok: z.literal(true) })),
	},
	platformBot: {
		connect: oc
			.input(
				z.object({
					mode: Mode,
					token: z.string().regex(/^\d+:[\w-]{30,}$/, "Not a bot token"),
				}),
			)
			.output(
				z.object({ id: z.string(), username: z.string(), status: z.string() }),
			),
	},
};
export type AdminContract = typeof adminContract;
