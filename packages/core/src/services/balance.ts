import type { BalanceObject, StarTransactionView } from "@starpay/contracts";
import {
	type StarTransaction,
	TelegramApiError,
	type TransactionPartner,
} from "@starpay/telegram";

import type { Deps, Scope } from "../deps";
import { errors } from "../errors";
import type { BotService } from "./bots";
import type { PayoutService } from "./payouts";

const BALANCE_MAX_AGE_MS = 60_000;
const PAGE_SIZE = 25;

function describe(tx: StarTransaction): Pick<
	StarTransactionView,
	"amount" | "kind"
> & {
	partner?: TransactionPartner;
} {
	// Incoming transactions have a source; outgoing ones have a receiver.
	if (tx.source) {
		return {
			amount: tx.amount,
			kind: tx.source.type === "user" ? "payment" : "other",
			partner: tx.source,
		};
	}
	const receiver = tx.receiver;
	return {
		amount: -tx.amount,
		kind:
			receiver?.type === "user"
				? "refund"
				: receiver?.type === "fragment"
					? "withdrawal"
					: "other",
		partner: receiver,
	};
}

export function createBalanceService(
	deps: Deps,
	bots: BotService,
	payouts: PayoutService,
) {
	const { db } = deps;

	return {
		async get(scope: Scope): Promise<BalanceObject> {
			let bot = await bots.find(scope);
			const ownActive =
				bot && bot.status !== "disconnected" && bot.status !== "invalid_token";
			if (!ownActive && (await bots.platformBot(scope.mode))) {
				// Hosted: the merchant's money is in the ledger, not in a bot of theirs.
				const balances = await db.$transaction((tx) =>
					payouts.computeBalances(tx, scope),
				);
				return {
					object: "balance",
					livemode: scope.mode === "live",
					settlement: "platform",
					stars: balances.withdrawable,
					synced_at: deps.now().toISOString(),
					pending: balances.pending,
					available: balances.available,
				};
			}
			const stale =
				!bot?.balanceSyncedAt ||
				deps.now().getTime() - bot.balanceSyncedAt.getTime() >
					BALANCE_MAX_AGE_MS;
			if (bot && bot.status !== "disconnected" && stale) {
				try {
					const balance = await bots.clientFor(bot).getMyStarBalance();
					bot = await db.bot.update({
						where: { id: bot.id },
						data: { starBalance: balance.amount, balanceSyncedAt: deps.now() },
					});
				} catch (error) {
					// Serve the cached value; the dashboard shows when it was last synced.
					console.error("[balance] getMyStarBalance failed", error);
				}
			}
			return {
				object: "balance",
				livemode: scope.mode === "live",
				settlement: "direct",
				stars: bot?.starBalance ?? null,
				synced_at: bot?.balanceSyncedAt?.toISOString() ?? null,
				pending: null,
				available: null,
			};
		},

		async transactions(scope: Scope, offset: number) {
			const bot = await bots.find(scope);
			if (!bot || bot.status === "disconnected")
				return { data: [], next_offset: null };

			let transactions: StarTransaction[];
			try {
				({ transactions } = await bots
					.clientFor(bot)
					.getStarTransactions({ offset, limit: PAGE_SIZE }));
			} catch (error) {
				throw errors.telegram(
					error instanceof TelegramApiError ? error.description : String(error),
				);
			}

			// Name payments and refunds after the order they belong to.
			const orderIds = transactions
				.map((tx) => (tx.source ?? tx.receiver)?.invoice_payload)
				.filter(
					(id): id is string => typeof id === "string" && id.startsWith("ord_"),
				);
			const orders = await db.order.findMany({
				where: { id: { in: orderIds }, organizationId: scope.organizationId },
				select: { id: true, title: true },
			});
			const titles = new Map(orders.map((order) => [order.id, order.title]));

			const data: StarTransactionView[] = transactions.map((tx) => {
				const { amount, kind, partner } = describe(tx);
				const orderId = partner?.invoice_payload?.startsWith("ord_")
					? partner.invoice_payload
					: null;
				const title = orderId ? titles.get(orderId) : undefined;
				const label =
					kind === "withdrawal"
						? "Withdrawal to Fragment"
						: `${kind === "refund" ? "Refund" : kind === "payment" ? "Payment" : (partner?.type ?? "Transaction")}${title ? ` · ${title}` : ""}`;
				return {
					id: tx.id,
					date: new Date(tx.date * 1000).toISOString(),
					amount,
					kind,
					label,
					order_id: orderId,
				};
			});
			return {
				data,
				next_offset:
					transactions.length === PAGE_SIZE ? offset + PAGE_SIZE : null,
			};
		},
	};
}
