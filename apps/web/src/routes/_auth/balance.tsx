import type { MerchantBalance, MerchantLedgerEntry } from "@starpay/contracts";
import { cn } from "@starpay/ui/lib/utils";
import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Landmark, Wallet } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import {
	Button,
	DataRow,
	DataTable,
	Dialog,
	EmptyState,
	ErrorState,
	Eyebrow,
	Field,
	inputClass,
	Mono,
	Panel,
	PanelHeader,
	Pill,
	RowsSkeleton,
	Shimmer,
	Star,
} from "@/components/kit";
import {
	formatDate,
	formatStars,
	formatUsd,
	formatWhen,
	timeAgo,
} from "@/lib/format";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/balance")({
	component: Balance,
	staticData: {
		title: "Balance",
		subtitle: "What you've earned and how you get paid",
	},
});

function Balance() {
	const balance = useQuery(orpc.payouts.balance.queryOptions());

	if (balance.isPending) {
		return (
			<div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5">
				{Array.from({ length: 4 }, (_, index) => (
					<Shimmer key={index} className="h-[118px] rounded-2xl" />
				))}
			</div>
		);
	}
	if (balance.isError) {
		return (
			<Panel>
				<ErrorState error={balance.error} onRetry={() => balance.refetch()} />
			</Panel>
		);
	}
	return balance.data.settlement === "platform" ? (
		<HostedBalance balance={balance.data} />
	) : (
		<DirectBalance />
	);
}

// ── Hosted: StarPay's bot, ledger balances, TON payouts ──

const percent = (bps: number) =>
	`${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

function feeSummary(plan: MerchantBalance["plan"]) {
	const parts = [percent(plan.percent_bps)];
	if (plan.fixed_stars > 0) parts.push(`+ ★ ${plan.fixed_stars}`);
	return `${parts.join(" ")} per payment`;
}

function HostedBalance({ balance }: { balance: MerchantBalance }) {
	const [requesting, setRequesting] = useState(false);
	const cards = [
		{
			label: "On hold",
			value: balance.pending,
			note: balance.next_release
				? `★ ${formatStars(balance.next_release.stars)} unlocks ${formatDate(balance.next_release.at)}`
				: `Payments unlock after ${balance.plan.hold_days} days`,
		},
		{
			label: "Available",
			value: balance.available,
			note:
				balance.reserved > 0
					? `★ ${formatStars(balance.reserved)} held in reserve`
					: "Ready to withdraw",
		},
		{
			label: "In payout",
			value: balance.in_payout,
			note: "Requested, not yet sent",
		},
	];

	return (
		<>
			<div className="grid gap-3.5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)]">
				<div className="flex flex-col gap-2 rounded-2xl bg-brand px-6 py-5 text-white">
					<Eyebrow className="text-[#CFE0FF]">You can withdraw</Eyebrow>
					<div className="flex items-baseline gap-2 font-extrabold text-[34px] tracking-[-0.03em]">
						<span aria-hidden className="text-[25px] text-star-bright">
							★
						</span>
						{formatStars(balance.withdrawable)}
					</div>
					<div className="text-[#DCE8FF] text-[12.5px]">
						≈ {formatUsd(balance.withdrawable)} · paid out in TON
					</div>
					<Button
						className="mt-2 self-start bg-white text-brand hover:bg-[#E8F0FF] dark:hover:bg-[#E8F0FF]"
						disabled={
							balance.withdrawable <
							balance.plan.min_payout_stars + balance.plan.payout_fee_stars
						}
						onClick={() => setRequesting(true)}
					>
						Request payout
					</Button>
					{balance.withdrawable <
						balance.plan.min_payout_stars + balance.plan.payout_fee_stars && (
						<div className="text-[#CFE0FF] text-[12px]">
							Minimum payout is ★ {formatStars(balance.plan.min_payout_stars)}
							{balance.plan.payout_fee_stars > 0 &&
								` plus a ★ ${balance.plan.payout_fee_stars} fee`}
							.
						</div>
					)}
				</div>
				<div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3.5">
					{cards.map((card) => (
						<Panel
							key={card.label}
							className="flex flex-col gap-1.5 px-5 py-[18px]"
						>
							<Eyebrow>{card.label}</Eyebrow>
							<div
								className={cn(
									"font-extrabold text-[26px] tracking-[-0.02em]",
									card.value < 0 && "text-[#B42318] dark:text-[#f97066]",
								)}
							>
								<Star className="text-[20px]" /> {formatStars(card.value)}
							</div>
							<div className="text-[12.5px] text-muted-foreground">
								{card.note}
							</div>
						</Panel>
					))}
				</div>
			</div>

			<Panel className="flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4 text-[13px]">
				<div>
					<span className="text-muted-foreground">Payments via </span>
					<span className="font-semibold">
						@{balance.platform_bot?.username ?? "StarPay"}
					</span>
				</div>
				<div>
					<span className="text-muted-foreground">Fee </span>
					<span className="font-semibold">{feeSummary(balance.plan)}</span>
				</div>
				<div>
					<span className="text-muted-foreground">Hold </span>
					<span className="font-semibold">{balance.plan.hold_days} days</span>
				</div>
				{balance.plan.reserve_bps > 0 && (
					<div>
						<span className="text-muted-foreground">Reserve </span>
						<span className="font-semibold">
							{percent(balance.plan.reserve_bps)} for{" "}
							{balance.plan.reserve_days} days
						</span>
					</div>
				)}
				<div>
					<span className="text-muted-foreground">Payout fee </span>
					<span className="font-semibold">
						★ {balance.plan.payout_fee_stars}
					</span>
				</div>
				<div className="min-w-0">
					<span className="text-muted-foreground">Payout wallet </span>
					{balance.payout_address ? (
						<Mono className="font-semibold">
							{shortAddress(balance.payout_address)}
						</Mono>
					) : (
						<Link
							to="/settings"
							className="font-semibold text-brand hover:underline"
						>
							Add a TON wallet →
						</Link>
					)}
				</div>
			</Panel>

			<Payouts />
			<LedgerHistory />

			<RequestPayoutDialog
				balance={balance}
				open={requesting}
				onOpenChange={setRequesting}
			/>
		</>
	);
}

function shortAddress(address: string) {
	return address.length > 16
		? `${address.slice(0, 6)}…${address.slice(-6)}`
		: address;
}

function RequestPayoutDialog({
	balance,
	open,
	onOpenChange,
}: {
	balance: MerchantBalance;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const queryClient = useQueryClient();
	const max = Math.max(0, balance.withdrawable - balance.plan.payout_fee_stars);
	const [amount, setAmount] = useState("");
	const request = useMutation(
		orpc.payouts.request.mutationOptions({
			onSuccess: () => {
				toast.success("Payout requested");
				setAmount("");
				onOpenChange(false);
				queryClient.invalidateQueries({ queryKey: orpc.payouts.key() });
			},
		}),
	);
	const value = Number(amount);
	const valid =
		Number.isInteger(value) &&
		value >= balance.plan.min_payout_stars &&
		value <= max;

	function onSubmit(event: FormEvent) {
		event.preventDefault();
		if (valid) request.mutate({ amount: value });
	}

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			title="Request a payout"
			description="Converted to TON at the current rate when it's sent."
		>
			{!balance.payout_address ? (
				<div className="flex flex-col gap-4">
					<p className="text-[13.5px] text-muted-foreground leading-relaxed">
						Add the TON wallet you want to be paid to first. Owners can set it
						in Settings.
					</p>
					<Link
						to="/settings"
						className="self-start font-semibold text-[13.5px] text-brand hover:underline"
					>
						Go to Settings →
					</Link>
				</div>
			) : (
				<form onSubmit={onSubmit} className="flex flex-col gap-4">
					<Field
						label="Amount in Stars"
						htmlFor="payout-amount"
						hint={`Between ★ ${formatStars(balance.plan.min_payout_stars)} and ★ ${formatStars(max)}`}
					>
						<div className="flex gap-2">
							<input
								id="payout-amount"
								type="number"
								inputMode="numeric"
								min={balance.plan.min_payout_stars}
								max={max}
								step={1}
								value={amount}
								onChange={(event) => setAmount(event.target.value)}
								className={inputClass}
							/>
							<Button
								variant="secondary"
								onClick={() => setAmount(String(max))}
							>
								Max
							</Button>
						</div>
					</Field>
					<dl className="flex flex-col divide-y divide-border rounded-xl border border-border text-[13px]">
						{[
							["Payout", `★ ${formatStars(valid ? value : 0)}`],
							["Payout fee", `★ ${formatStars(balance.plan.payout_fee_stars)}`],
							[
								"Deducted from balance",
								`★ ${formatStars((valid ? value : 0) + balance.plan.payout_fee_stars)}`,
							],
							["To wallet", shortAddress(balance.payout_address)],
						].map(([label, text]) => (
							<div key={label} className="flex justify-between px-4 py-2.5">
								<dt className="text-muted-foreground">{label}</dt>
								<dd className="font-semibold">{text}</dd>
							</div>
						))}
					</dl>
					{!balance.automatic_payouts && (
						<p className="text-[12.5px] text-muted-foreground">
							The StarPay team sends payouts by hand for now, usually within one
							business day.
						</p>
					)}
					<div className="flex justify-end gap-2">
						<Button variant="secondary" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={!valid} loading={request.isPending}>
							Request payout
						</Button>
					</div>
				</form>
			)}
		</Dialog>
	);
}

const PAYOUT_COLUMNS = "130px 110px 90px minmax(120px,1fr) 110px 100px";

function Payouts() {
	const queryClient = useQueryClient();
	const payouts = useQuery(
		orpc.payouts.list.queryOptions({ input: { limit: 20 } }),
	);
	const cancel = useMutation(
		orpc.payouts.cancel.mutationOptions({
			onSuccess: () => {
				toast.success("Payout cancelled; the Stars are back in your balance");
				queryClient.invalidateQueries({ queryKey: orpc.payouts.key() });
			},
		}),
	);

	return (
		<Panel>
			<PanelHeader title="Payouts" description="TON sent to your wallet" />
			<DataTable
				label="Payouts"
				columns={PAYOUT_COLUMNS}
				className="min-w-[680px]"
				head={["Requested", "Amount", "TON", "Reference", "Status", ""]}
				state={
					payouts.isPending ? (
						<RowsSkeleton rows={3} />
					) : payouts.isError ? (
						<ErrorState
							error={payouts.error}
							onRetry={() => payouts.refetch()}
						/>
					) : payouts.data.data.length === 0 ? (
						<EmptyState icon={<Landmark />} title="No payouts yet">
							Request one once your earnings are available.
						</EmptyState>
					) : undefined
				}
			>
				{payouts.data?.data.map((payout) => (
					<DataRow key={payout.id}>
						<Mono className="text-muted-foreground">
							{formatWhen(payout.created_at)}
						</Mono>
						<div className="font-bold">
							<Star /> {formatStars(payout.amount)}
						</div>
						<Mono>{payout.ton_amount ?? "—"}</Mono>
						<Mono
							className="truncate text-muted-foreground"
							title={payout.failure_reason ?? payout.tx_reference ?? ""}
						>
							{payout.failure_reason ?? payout.tx_reference ?? "—"}
						</Mono>
						<PayoutStatus status={payout.status} />
						<div className="text-right">
							{payout.status === "requested" && (
								<Button
									variant="ghost"
									size="sm"
									loading={
										cancel.isPending && cancel.variables?.id === payout.id
									}
									onClick={() => cancel.mutate({ id: payout.id })}
								>
									Cancel
								</Button>
							)}
						</div>
					</DataRow>
				))}
			</DataTable>
		</Panel>
	);
}

function PayoutStatus({ status }: { status: string }) {
	const tone = {
		requested: "warning",
		sending: "brand",
		paid: "success",
		failed: "danger",
		cancelled: "muted",
	} as const;
	return (
		<Pill tone={tone[status as keyof typeof tone] ?? "neutral"}>{status}</Pill>
	);
}

const LEDGER_LABELS: Record<string, string> = {
	payment: "Payment",
	release: "Hold ended",
	refund: "Refund",
	payout_request: "Payout requested",
	payout_paid: "Payout sent",
	payout_reversed: "Payout returned",
	adjustment: "Adjustment",
};

function Change({ value }: { value: number }) {
	if (value === 0) return <span className="text-faint">—</span>;
	return (
		<span
			className={cn(
				"font-semibold",
				value > 0
					? "text-[#067647] dark:text-[#47cd89]"
					: "text-[#B42318] dark:text-[#f97066]",
			)}
		>
			{value > 0 ? "+" : "−"} {formatStars(Math.abs(value))}
		</span>
	);
}

const LEDGER_COLUMNS = "130px minmax(160px,1fr) 100px 100px 100px";

function LedgerHistory() {
	const ledger = useInfiniteQuery(
		orpc.payouts.ledger.infiniteOptions({
			input: (cursor: string | undefined) => ({
				limit: 25,
				starting_after: cursor,
			}),
			initialPageParam: undefined,
			getNextPageParam: (page) =>
				page.has_more ? page.data.at(-1)?.id : undefined,
		}),
	);
	const rows: MerchantLedgerEntry[] =
		ledger.data?.pages.flatMap((page) => page.data) ?? [];

	return (
		<Panel>
			<PanelHeader
				title="Ledger"
				description="Every movement of your StarPay balance"
			/>
			<DataTable
				label="Ledger"
				columns={LEDGER_COLUMNS}
				className="min-w-[640px]"
				head={["Date", "Entry", "On hold", "Available", "In payout"]}
				state={
					ledger.isPending ? (
						<RowsSkeleton rows={5} />
					) : ledger.isError ? (
						<ErrorState error={ledger.error} onRetry={() => ledger.refetch()} />
					) : rows.length === 0 ? (
						<EmptyState title="Nothing yet">
							Payments through StarPay's bot will show up here.
						</EmptyState>
					) : undefined
				}
			>
				{rows.map((row) => (
					<DataRow key={row.id}>
						<Mono className="text-muted-foreground">
							{formatWhen(row.created_at)}
						</Mono>
						<div className="min-w-0">
							<div className="truncate font-semibold">
								{LEDGER_LABELS[row.type] ?? row.type}
							</div>
							<Mono className="block truncate text-[11.5px] text-faint">
								{row.payout_id ?? row.payment_id ?? ""}
							</Mono>
						</div>
						<Change value={row.pending_change} />
						<Change value={row.available_change} />
						<Change value={row.payout_change} />
					</DataRow>
				))}
			</DataTable>
			{ledger.hasNextPage && (
				<div className="px-5 py-3.5">
					<Button
						variant="secondary"
						size="sm"
						loading={ledger.isFetchingNextPage}
						onClick={() => ledger.fetchNextPage()}
					>
						Load more
					</Button>
				</div>
			)}
		</Panel>
	);
}

// ── Direct: the merchant's own bot holds the Stars ──

function DirectBalance() {
	const bot = useQuery(orpc.bot.get.queryOptions());
	const balance = useQuery(orpc.balance.get.queryOptions());

	if (bot.data === null) {
		return (
			<Panel>
				<EmptyState
					icon={<Wallet />}
					title="No bot connected"
					action={
						<Link
							to="/bot"
							className="font-semibold text-[13px] text-brand hover:underline"
						>
							Connect your bot →
						</Link>
					}
				>
					Stars are paid into your bot's balance on Telegram. Connect the bot to
					see it here.
				</EmptyState>
			</Panel>
		);
	}

	return (
		<>
			<div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
				<Panel className="flex flex-col gap-1.5 px-6 py-5">
					<Eyebrow>Bot Star balance</Eyebrow>
					{balance.isPending ? (
						<Shimmer className="my-2 h-10 w-40" />
					) : balance.isError ? (
						<p className="text-[13px] text-destructive">
							{balance.error.message}
						</p>
					) : balance.data.stars === null ? (
						<div className="py-2 text-[13px] text-muted-foreground">
							Not synced yet. Telegram didn't return a balance.
						</div>
					) : (
						<>
							<div className="flex items-baseline gap-2 font-extrabold text-[38px] tracking-[-0.03em]">
								<Star className="text-[28px]" />
								{formatStars(balance.data.stars)}
							</div>
							<div className="text-[13px] text-muted-foreground">
								≈ {formatUsd(balance.data.stars)} USD · estimate
							</div>
						</>
					)}
					<Mono className="mt-1 text-[11.5px] text-faint">
						synced from Telegram · {timeAgo(balance.data?.synced_at)}
					</Mono>
				</Panel>
				<Panel className="flex flex-col gap-2 border-brand-line bg-brand-soft px-6 py-5">
					<h2 className="font-bold text-[14.5px]">
						Withdrawals happen on Fragment
					</h2>
					<p className="text-[13px] text-muted-foreground leading-relaxed">
						Your own bot holds these Stars, so StarPay never touches them.
						Withdraw them yourself on Fragment, which pays out in TON. Telegram
						holds new Stars for up to 21 days before they become withdrawable.
					</p>
					<a
						href="https://fragment.com"
						target="_blank"
						rel="noreferrer"
						className="mt-1 inline-flex items-center gap-1 self-start font-semibold text-[13px] text-brand hover:underline"
					>
						Open Fragment <ArrowUpRight className="size-4" />
					</a>
				</Panel>
			</div>
			<Transactions />
		</>
	);
}

function Transactions() {
	const transactions = useInfiniteQuery(
		orpc.balance.transactions.infiniteOptions({
			input: (offset: number) => ({ offset }),
			initialPageParam: 0,
			getNextPageParam: (page) => page.next_offset ?? undefined,
		}),
	);
	const rows = transactions.data?.pages.flatMap((page) => page.data) ?? [];

	return (
		<Panel>
			<PanelHeader
				title="Transaction history"
				description="Live from Telegram, newest first"
			/>
			{transactions.isPending ? (
				<RowsSkeleton rows={6} />
			) : transactions.isError ? (
				<ErrorState
					error={transactions.error}
					onRetry={() => transactions.refetch()}
				/>
			) : rows.length === 0 ? (
				<EmptyState title="No transactions yet">
					Payments, refunds and withdrawals appear here.
				</EmptyState>
			) : (
				<>
					{rows.map((tx) => (
						<div
							key={tx.id}
							className="grid grid-cols-[120px_minmax(0,1fr)_110px] items-center gap-3 border-border/60 border-b px-5 py-3 text-[13.5px] last:border-b-0"
						>
							<Mono className="text-muted-foreground">
								{formatWhen(tx.date)}
							</Mono>
							<div className="truncate">
								{tx.order_id ? (
									<Link
										to="/payments"
										search={{ order: tx.order_id }}
										className="hover:underline"
									>
										{tx.label}
									</Link>
								) : (
									tx.label
								)}
							</div>
							<div
								className={cn(
									"whitespace-nowrap text-right font-bold",
									tx.amount >= 0
										? "text-[#067647] dark:text-[#47cd89]"
										: "text-[#B42318] dark:text-[#f97066]",
								)}
							>
								{tx.amount >= 0 ? "+" : "−"} ★{" "}
								{formatStars(Math.abs(tx.amount))}
							</div>
						</div>
					))}
					{transactions.hasNextPage && (
						<div className="px-5 py-3.5">
							<Button
								variant="secondary"
								size="sm"
								loading={transactions.isFetchingNextPage}
								onClick={() => transactions.fetchNextPage()}
							>
								Load more
							</Button>
						</div>
					)}
				</>
			)}
		</Panel>
	);
}
