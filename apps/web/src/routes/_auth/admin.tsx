import type { FeePlanView, Mode } from "@starpay/contracts";
import { cn } from "@starpay/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import {
	Button,
	CopyButton,
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
	Segmented,
	Star,
} from "@/components/kit";
import { formatStars, formatWhen } from "@/lib/format";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/admin")({
	beforeLoad: async () => {
		const me = await client.me().catch(() => null);
		if (!me?.platform_admin) throw redirect({ to: "/" });
	},
	component: Admin,
	staticData: {
		title: "Platform admin",
		subtitle: "StarPay's money, payouts and fees",
	},
});

type Tab = "overview" | "payouts" | "plans" | "merchants";

function Admin() {
	const [mode, setMode] = useState<Mode>("live");
	const [tab, setTab] = useState<Tab>("overview");

	return (
		<>
			<div className="flex flex-wrap items-center gap-3">
				<Segmented
					label="Section"
					value={tab}
					onChange={setTab}
					options={[
						{ value: "overview", label: "Overview" },
						{ value: "payouts", label: "Payouts" },
						{ value: "plans", label: "Fee plans" },
						{ value: "merchants", label: "Merchants" },
					]}
				/>
				{tab !== "plans" && (
					<Segmented
						label="Mode"
						value={mode}
						onChange={setMode}
						options={[
							{ value: "live", label: "Live" },
							{ value: "test", label: "Test" },
						]}
					/>
				)}
			</div>
			{tab === "overview" && <Overview mode={mode} />}
			{tab === "payouts" && <PayoutQueue mode={mode} />}
			{tab === "plans" && <FeePlans />}
			{tab === "merchants" && <Merchants mode={mode} />}
		</>
	);
}

// ── Overview ──

function Overview({ mode }: { mode: Mode }) {
	const overview = useQuery(
		orpc.admin.overview.queryOptions({ input: { mode } }),
	);
	if (overview.isPending) {
		return (
			<Panel>
				<RowsSkeleton rows={5} />
			</Panel>
		);
	}
	if (overview.isError) {
		return (
			<Panel>
				<ErrorState error={overview.error} onRetry={() => overview.refetch()} />
			</Panel>
		);
	}
	const data = overview.data;
	const diff =
		data.platform.telegram_actual === null
			? null
			: data.platform.telegram_actual - data.platform.telegram_ledger;

	const cards = [
		{
			label: "In the platform bot",
			value: data.platform.telegram_ledger,
			note:
				diff === null
					? "Telegram balance unavailable"
					: diff === 0
						? "Matches Telegram ✓"
						: `Telegram reports ★ ${formatStars(data.platform.telegram_actual ?? 0)} (${diff > 0 ? "+" : ""}${formatStars(diff)})`,
			warn: diff !== null && diff !== 0,
		},
		{
			label: "TON treasury",
			value: data.platform.treasury,
			note: "Withdrawn via Fragment, minus payouts sent",
			warn: data.platform.treasury < 0,
		},
		{
			label: "Fees earned",
			value: data.platform.fees_earned,
			note: "Commission, net of refunds",
			warn: false,
		},
		{
			label: "Owed to merchants",
			value:
				data.liabilities.pending +
				data.liabilities.available +
				data.liabilities.in_payout,
			note: `★ ${formatStars(data.liabilities.pending)} on hold · ★ ${formatStars(data.liabilities.available)} available · ★ ${formatStars(data.liabilities.in_payout)} in payout`,
			warn: false,
		},
	];

	return (
		<>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-3.5">
				{cards.map((card) => (
					<Panel
						key={card.label}
						className={cn(
							"flex flex-col gap-1.5 px-5 py-[18px]",
							card.warn && "border-[#FDA29B]",
						)}
					>
						<Eyebrow>{card.label}</Eyebrow>
						<div className="font-extrabold text-[26px] tracking-[-0.02em]">
							<Star className="text-[20px]" /> {formatStars(card.value)}
						</div>
						<div
							className={cn(
								"text-[12.5px] text-muted-foreground",
								card.warn && "text-[#B42318] dark:text-[#f97066]",
							)}
						>
							{card.note}
						</div>
					</Panel>
				))}
			</div>

			<div className="grid gap-3.5 lg:grid-cols-2">
				<PlatformBot mode={mode} bot={data.platform_bot} />
				<Panel className="flex flex-col gap-3 p-5">
					<h2 className="font-bold text-[14.5px]">Payouts</h2>
					<div className="text-[13px] text-muted-foreground">
						<strong className="text-foreground">{data.payouts_waiting}</strong>{" "}
						waiting ·{" "}
						{data.automatic_payouts
							? "sent automatically from the hot wallet"
							: "processed by hand (no hot wallet configured)"}
					</div>
					{data.wallet_balance_ton !== null && (
						<div className="text-[13px]">
							<span className="text-muted-foreground">Hot wallet holds </span>
							<strong>{data.wallet_balance_ton} TON</strong>
						</div>
					)}
					{data.wallet_address && (
						<div className="flex items-center gap-1 text-[12.5px]">
							<span className="text-muted-foreground">Hot wallet</span>
							<Mono className="truncate">{data.wallet_address}</Mono>
							<CopyButton value={data.wallet_address} label="" />
						</div>
					)}
				</Panel>
			</div>

			<RecordWithdrawal mode={mode} />
		</>
	);
}

function PlatformBot({
	mode,
	bot,
}: {
	mode: Mode;
	bot: { username: string; status: string } | null;
}) {
	const queryClient = useQueryClient();
	const [token, setToken] = useState("");
	const connect = useMutation(
		orpc.admin.platformBot.connect.mutationOptions({
			onSuccess: (view) => {
				toast.success(`@${view.username} is now StarPay's ${mode} bot`);
				setToken("");
				queryClient.invalidateQueries({ queryKey: orpc.admin.key() });
			},
		}),
	);

	return (
		<Panel className="flex flex-col gap-3 p-5">
			<div className="flex items-center justify-between gap-2">
				<h2 className="font-bold text-[14.5px]">Platform bot ({mode})</h2>
				{bot && (
					<Pill tone={bot.status === "active" ? "success" : "danger"}>
						{bot.status}
					</Pill>
				)}
			</div>
			<p className="text-[13px] text-muted-foreground">
				{bot
					? `@${bot.username} takes payments for every merchant without their own ${mode} bot.`
					: `No ${mode} platform bot yet: merchants without their own bot can't take payments.`}
			</p>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					if (token.trim()) connect.mutate({ mode, token: token.trim() });
				}}
				className="flex gap-2"
			>
				<input
					aria-label="Platform bot token"
					value={token}
					onChange={(event) => setToken(event.target.value)}
					placeholder={
						bot ? "Replace with a new token…" : "Bot token from @BotFather"
					}
					autoComplete="off"
					spellCheck={false}
					className={`${inputClass} font-mono`}
				/>
				<Button
					type="submit"
					variant="secondary"
					loading={connect.isPending}
					disabled={!token.trim()}
				>
					{bot ? "Replace" : "Connect"}
				</Button>
			</form>
		</Panel>
	);
}

function RecordWithdrawal({ mode }: { mode: Mode }) {
	const queryClient = useQueryClient();
	const record = useMutation(
		orpc.admin.recordWithdrawal.mutationOptions({
			onSuccess: () => {
				toast.success("Withdrawal recorded");
				queryClient.invalidateQueries({ queryKey: orpc.admin.key() });
			},
		}),
	);

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		const stars = Number(form.get("stars"));
		if (!Number.isInteger(stars) || stars < 1) {
			toast.error("Enter the number of Stars withdrawn");
			return;
		}
		record.mutate({
			mode,
			stars,
			ton_received: String(form.get("ton") ?? "").trim() || undefined,
			note: String(form.get("note") ?? "").trim() || undefined,
		});
		event.currentTarget.reset();
	}

	return (
		<Panel>
			<PanelHeader
				title="Record a Fragment withdrawal"
				description="After withdrawing the platform bot's Stars on Fragment, record it here so the books move Stars from the bot to the TON treasury."
			/>
			<form
				onSubmit={onSubmit}
				className="grid gap-4 p-5 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end"
			>
				<Field label="Stars withdrawn" htmlFor="w-stars">
					<input
						id="w-stars"
						name="stars"
						type="number"
						min={1}
						step={1}
						required
						className={inputClass}
					/>
				</Field>
				<Field label="TON received" htmlFor="w-ton">
					<input
						id="w-ton"
						name="ton"
						inputMode="decimal"
						placeholder="e.g. 125.4"
						className={inputClass}
					/>
				</Field>
				<Field label="Note" htmlFor="w-note">
					<input
						id="w-note"
						name="note"
						placeholder="Fragment reference"
						className={inputClass}
					/>
				</Field>
				<Button type="submit" loading={record.isPending}>
					Record
				</Button>
			</form>
		</Panel>
	);
}

// ── Payout queue ──

const PAYOUT_COLUMNS =
	"130px minmax(130px,1fr) 100px minmax(150px,1.2fr) 100px 170px";
type PayoutAction = { kind: "paid" | "failed"; id: string; amount: number };

function PayoutQueue({ mode }: { mode: Mode }) {
	const [status, setStatus] = useState<
		"requested" | "sending" | "paid" | "failed" | "all"
	>("requested");
	const [action, setAction] = useState<PayoutAction | null>(null);
	const payouts = useQuery(
		orpc.admin.payouts.list.queryOptions({
			input: { mode, status: status === "all" ? undefined : status, limit: 50 },
		}),
	);

	return (
		<>
			<Segmented
				label="Payout status"
				value={status}
				onChange={setStatus}
				options={[
					{ value: "requested", label: "Waiting" },
					{ value: "sending", label: "Sending" },
					{ value: "paid", label: "Paid" },
					{ value: "failed", label: "Failed" },
					{ value: "all", label: "All" },
				]}
			/>
			<Panel>
				<DataTable
					label="Payout queue"
					columns={PAYOUT_COLUMNS}
					className="min-w-[820px]"
					head={["Requested", "Merchant", "Amount", "To wallet", "Status", ""]}
					state={
						payouts.isPending ? (
							<RowsSkeleton rows={4} />
						) : payouts.isError ? (
							<ErrorState
								error={payouts.error}
								onRetry={() => payouts.refetch()}
							/>
						) : payouts.data.data.length === 0 ? (
							<EmptyState title="Nothing here">
								No payouts with this status.
							</EmptyState>
						) : undefined
					}
				>
					{payouts.data?.data.map((payout) => (
						<DataRow key={payout.id}>
							<Mono className="text-muted-foreground">
								{formatWhen(payout.created_at)}
							</Mono>
							<div className="truncate font-semibold">
								{payout.organization.name}
							</div>
							<div className="font-bold">
								<Star /> {formatStars(payout.amount)}
							</div>
							<div className="flex min-w-0 items-center gap-1">
								<Mono className="truncate">{payout.ton_address}</Mono>
								<CopyButton value={payout.ton_address} label="" />
							</div>
							<Pill
								tone={
									payout.status === "paid"
										? "success"
										: payout.status === "failed"
											? "danger"
											: "warning"
								}
							>
								{payout.status}
							</Pill>
							<div className="flex justify-end gap-1">
								{(payout.status === "requested" ||
									payout.status === "sending") && (
									<>
										<Button
											size="sm"
											onClick={() =>
												setAction({
													kind: "paid",
													id: payout.id,
													amount: payout.amount,
												})
											}
										>
											Mark paid
										</Button>
										<Button
											size="sm"
											variant="ghost"
											onClick={() =>
												setAction({
													kind: "failed",
													id: payout.id,
													amount: payout.amount,
												})
											}
										>
											Fail
										</Button>
									</>
								)}
							</div>
						</DataRow>
					))}
				</DataTable>
			</Panel>
			<PayoutActionDialog action={action} onClose={() => setAction(null)} />
		</>
	);
}

function PayoutActionDialog({
	action,
	onClose,
}: {
	action: PayoutAction | null;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const done = (message: string) => {
		toast.success(message);
		queryClient.invalidateQueries({ queryKey: orpc.admin.key() });
		onClose();
	};
	const paid = useMutation(
		orpc.admin.payouts.markPaid.mutationOptions({
			onSuccess: () => done("Marked paid"),
		}),
	);
	const failed = useMutation(
		orpc.admin.payouts.markFailed.mutationOptions({
			onSuccess: () => done("Marked failed; Stars returned to the merchant"),
		}),
	);

	return (
		<Dialog
			open={action !== null}
			onOpenChange={(open) => !open && onClose()}
			title={
				action?.kind === "paid" ? "Mark payout as paid" : "Fail this payout"
			}
			description={
				action?.kind === "paid"
					? `Only after you've sent the TON for ★ ${formatStars(action?.amount ?? 0)}. This moves the money out of the treasury.`
					: "The Stars and payout fee go back to the merchant's available balance."
			}
		>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					if (!action) return;
					const value = String(
						new FormData(event.currentTarget).get("value") ?? "",
					).trim();
					if (action.kind === "paid")
						paid.mutate({ id: action.id, tx_reference: value });
					else failed.mutate({ id: action.id, reason: value });
				}}
				className="flex flex-col gap-4"
			>
				<Field
					label={
						action?.kind === "paid"
							? "TON transaction hash or link"
							: "Reason (shown to the merchant)"
					}
					htmlFor="payout-action-value"
				>
					<input
						id="payout-action-value"
						name="value"
						required
						minLength={3}
						className={inputClass}
					/>
				</Field>
				<div className="flex justify-end gap-2">
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button
						type="submit"
						variant={action?.kind === "paid" ? "primary" : "danger"}
						loading={paid.isPending || failed.isPending}
					>
						{action?.kind === "paid" ? "Mark paid" : "Fail payout"}
					</Button>
				</div>
			</form>
		</Dialog>
	);
}

// ── Fee plans ──

const PLAN_FIELDS = [
	["percent_bps", "Commission (basis points)", "500 = 5%"],
	["fixed_stars", "Flat fee per payment (Stars)", ""],
	[
		"payout_fee_bps",
		"Payout commission (basis points)",
		"Taken out of each payout",
	],
	["payout_fee_stars", "Flat payout fee (Stars)", ""],
	["min_payout_stars", "Minimum payout (Stars)", ""],
	["hold_days", "Hold (days)", "Telegram holds Stars ~21 days"],
	[
		"reserve_bps",
		"Reserve (basis points)",
		"Share of recent earnings kept back",
	],
	["reserve_days", "Reserve window (days)", ""],
] as const;

function planSummary(plan: FeePlanView) {
	const payoutFee = [
		plan.payout_fee_bps ? `${plan.payout_fee_bps / 100}%` : "",
		plan.payout_fee_stars ? `★${plan.payout_fee_stars}` : "",
		`${plan.payout_gas_ton} TON gas`,
	]
		.filter(Boolean)
		.join(" + ");
	return `${plan.percent_bps / 100}%${plan.fixed_stars ? ` + ★${plan.fixed_stars}` : ""} per payment · hold ${plan.hold_days}d · reserve ${plan.reserve_bps / 100}%/${plan.reserve_days}d · payout ${payoutFee} · min ★${plan.min_payout_stars}`;
}

function FeePlans() {
	const queryClient = useQueryClient();
	const plans = useQuery(orpc.admin.feePlans.list.queryOptions());
	const [editing, setEditing] = useState<FeePlanView | "new" | null>(null);
	const setDefault = useMutation(
		orpc.admin.feePlans.setDefault.mutationOptions({
			onSuccess: (plan) => {
				toast.success(`${plan.name} is now the default`);
				queryClient.invalidateQueries({ queryKey: orpc.admin.key() });
			},
		}),
	);

	return (
		<>
			<Panel>
				<PanelHeader
					title="Fee plans"
					description="Changes apply to new payments; each payment keeps the fee it was charged."
					action={<Button onClick={() => setEditing("new")}>New plan</Button>}
				/>
				{plans.isPending ? (
					<RowsSkeleton rows={3} />
				) : plans.isError ? (
					<ErrorState error={plans.error} onRetry={() => plans.refetch()} />
				) : (
					plans.data.map((plan) => (
						<div
							key={plan.id}
							className="flex flex-wrap items-center gap-3 border-border/60 border-b px-5 py-3.5 last:border-b-0"
						>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2 font-semibold">
									{plan.name}{" "}
									{plan.is_default && <Pill tone="brand">default</Pill>}
								</div>
								<div className="text-[12.5px] text-muted-foreground">
									{planSummary(plan)}
								</div>
							</div>
							{!plan.is_default && (
								<Button
									variant="ghost"
									size="sm"
									onClick={() => setDefault.mutate({ id: plan.id })}
								>
									Make default
								</Button>
							)}
							<Button
								variant="secondary"
								size="sm"
								onClick={() => setEditing(plan)}
							>
								Edit
							</Button>
						</div>
					))
				)}
			</Panel>
			<FeePlanDialog editing={editing} onClose={() => setEditing(null)} />
		</>
	);
}

function FeePlanDialog({
	editing,
	onClose,
}: {
	editing: FeePlanView | "new" | null;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const plan = editing === "new" ? null : editing;
	const done = () => {
		toast.success("Plan saved");
		queryClient.invalidateQueries({ queryKey: orpc.admin.key() });
		onClose();
	};
	const create = useMutation(
		orpc.admin.feePlans.create.mutationOptions({ onSuccess: done }),
	);
	const update = useMutation(
		orpc.admin.feePlans.update.mutationOptions({ onSuccess: done }),
	);

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		const number = (key: string) => Number(form.get(key));
		const values = {
			name: String(form.get("name") ?? "").trim(),
			percent_bps: number("percent_bps"),
			fixed_stars: number("fixed_stars"),
			payout_fee_bps: number("payout_fee_bps"),
			payout_fee_stars: number("payout_fee_stars"),
			payout_gas_ton: String(form.get("payout_gas_ton") ?? "0").trim(),
			min_payout_stars: number("min_payout_stars"),
			hold_days: number("hold_days"),
			reserve_bps: number("reserve_bps"),
			reserve_days: number("reserve_days"),
		};
		if (plan) update.mutate({ id: plan.id, ...values });
		else create.mutate(values);
	}

	return (
		<Dialog
			open={editing !== null}
			onOpenChange={(open) => !open && onClose()}
			title={plan ? `Edit ${plan.name}` : "New fee plan"}
		>
			<form
				key={plan?.id ?? "new"}
				onSubmit={onSubmit}
				className="flex flex-col gap-4"
			>
				<Field label="Name" htmlFor="plan-name">
					<input
						id="plan-name"
						name="name"
						required
						maxLength={64}
						defaultValue={plan?.name}
						className={inputClass}
					/>
				</Field>
				<Field
					label="Network gas per payout (TON)"
					htmlFor="plan-gas"
					hint="Reserved to cover the TON transfer; priced in Stars when a payout is requested"
				>
					<input
						id="plan-gas"
						name="payout_gas_ton"
						inputMode="decimal"
						pattern="[0-9]*\.?[0-9]*"
						required
						defaultValue={plan?.payout_gas_ton ?? "0.01"}
						className={inputClass}
					/>
				</Field>
				<div className="grid gap-4 sm:grid-cols-2">
					{PLAN_FIELDS.map(([key, label, hint]) => (
						<Field
							key={key}
							label={label}
							htmlFor={`plan-${key}`}
							hint={hint || undefined}
						>
							<input
								id={`plan-${key}`}
								name={key}
								type="number"
								min={key === "min_payout_stars" ? 1 : 0}
								max={key.endsWith("_bps") ? 10000 : undefined}
								step={1}
								required
								defaultValue={
									plan?.[key] ??
									(key === "hold_days"
										? 21
										: key === "min_payout_stars"
											? 1000
											: 0)
								}
								className={inputClass}
							/>
						</Field>
					))}
				</div>
				<div className="flex justify-end gap-2">
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button type="submit" loading={create.isPending || update.isPending}>
						Save plan
					</Button>
				</div>
			</form>
		</Dialog>
	);
}

// ── Merchants ──

const MERCHANT_COLUMNS =
	"minmax(160px,1.4fr) 100px 100px 100px minmax(160px,1fr)";

function Merchants({ mode }: { mode: Mode }) {
	const queryClient = useQueryClient();
	const merchants = useQuery(
		orpc.admin.merchants.list.queryOptions({ input: { mode } }),
	);
	const plans = useQuery(orpc.admin.feePlans.list.queryOptions());
	const setPlan = useMutation(
		orpc.admin.merchants.setFeePlan.mutationOptions({
			onSuccess: () => {
				toast.success("Fee plan updated");
				queryClient.invalidateQueries({ queryKey: orpc.admin.merchants.key() });
			},
		}),
	);

	return (
		<Panel>
			<DataTable
				label="Merchants"
				columns={MERCHANT_COLUMNS}
				className="min-w-[720px]"
				head={["Merchant", "On hold", "Available", "In payout", "Fee plan"]}
				state={
					merchants.isPending ? (
						<RowsSkeleton rows={5} />
					) : merchants.isError ? (
						<ErrorState
							error={merchants.error}
							onRetry={() => merchants.refetch()}
						/>
					) : undefined
				}
			>
				{merchants.data?.map((merchant) => (
					<DataRow key={merchant.id}>
						<div className="min-w-0">
							<div className="truncate font-semibold">{merchant.name}</div>
							<Mono className="text-[11.5px] text-faint">{merchant.id}</Mono>
						</div>
						<div>★ {formatStars(merchant.pending)}</div>
						<div
							className={cn(
								merchant.available < 0 && "text-[#B42318] dark:text-[#f97066]",
							)}
						>
							★ {formatStars(merchant.available)}
						</div>
						<div>★ {formatStars(merchant.in_payout)}</div>
						<select
							aria-label={`Fee plan for ${merchant.name}`}
							value={merchant.fee_plan_id ?? ""}
							onChange={(event) =>
								setPlan.mutate({
									organization_id: merchant.id,
									fee_plan_id: event.target.value || null,
								})
							}
							className={`${inputClass} py-1.5`}
						>
							<option value="">Default plan</option>
							{plans.data?.map((plan) => (
								<option key={plan.id} value={plan.id}>
									{plan.name}
								</option>
							))}
						</select>
					</DataRow>
				))}
			</DataTable>
		</Panel>
	);
}
