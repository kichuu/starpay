import type { SettingsView } from "@starpay/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
	Avatar,
	Button,
	CopyButton,
	ErrorState,
	inputClass,
	Mono,
	Panel,
	PanelHeader,
	Pill,
	RowsSkeleton,
	Toggle,
} from "@/components/kit";
import { authClient } from "@/lib/auth-client";
import { initials } from "@/lib/format";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/settings")({
	component: Settings,
	staticData: { title: "Settings", subtitle: "Team, support and alerts" },
});

function Settings() {
	const settings = useQuery(orpc.settings.get.queryOptions());

	return (
		<div className="grid gap-3.5 lg:grid-cols-2">
			<Team />
			<div className="flex flex-col gap-3.5">
				{settings.isPending ? (
					<Panel>
						<RowsSkeleton rows={4} />
					</Panel>
				) : settings.isError ? (
					<Panel>
						<ErrorState
							error={settings.error}
							onRetry={() => settings.refetch()}
						/>
					</Panel>
				) : (
					<>
						<PayoutWallet settings={settings.data} />
						<PaySupport settings={settings.data} />
						<Notifications settings={settings.data} />
					</>
				)}
			</div>
		</div>
	);
}

function Team() {
	const { data: organization, isPending } = authClient.useActiveOrganization();
	const ROLE_TONE = {
		owner: "success",
		developer: "brand",
		support: "neutral",
	} as const;

	return (
		<Panel className="self-start">
			<PanelHeader
				title="Team"
				description={organization?.name}
				action={
					<Button
						variant="secondary"
						size="sm"
						disabled
						title="Email invitations are coming soon"
					>
						Invite
					</Button>
				}
			/>
			{isPending ? (
				<RowsSkeleton rows={3} />
			) : (
				organization?.members.map((member) => (
					<div
						key={member.id}
						className="flex items-center gap-3 border-border/60 border-b px-5 py-3 last:border-b-0"
					>
						<Avatar text={initials(member.user.name)} />
						<div className="min-w-0 flex-1">
							<div className="truncate font-semibold text-[13.5px]">
								{member.user.name}
							</div>
							<div className="truncate text-[12px] text-muted-foreground">
								{member.user.email}
							</div>
						</div>
						<Pill
							tone={
								ROLE_TONE[member.role as keyof typeof ROLE_TONE] ?? "neutral"
							}
							className="capitalize"
						>
							{member.role}
						</Pill>
					</div>
				))
			)}
			<UserId />
			<p className="px-5 py-3 text-[12px] text-muted-foreground leading-relaxed">
				Owners manage the team, settings and payouts. Developers manage the bot,
				products and API keys. Support can view everything and issue refunds.
			</p>
		</Panel>
	);
}

function UserId() {
	const me = useQuery(orpc.me.queryOptions());
	if (!me.data) return null;
	return (
		<div className="flex items-center justify-between gap-2 border-border/60 border-t px-5 py-2.5 text-[12px] text-muted-foreground">
			<span>Your user ID</span>
			<span className="flex items-center gap-1">
				<Mono>{me.data.user_id}</Mono>
				<CopyButton value={me.data.user_id} label="" />
			</span>
		</div>
	);
}

function useSaveSettings(message: string) {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.settings.update.mutationOptions({
			onSuccess: (view) => {
				queryClient.setQueryData(orpc.settings.get.queryKey(), view);
				toast.success(message);
			},
			onError: () => {
				queryClient.invalidateQueries({ queryKey: orpc.settings.key() });
			},
		}),
	);
}

function PayoutWallet({ settings }: { settings: SettingsView }) {
	const [address, setAddress] = useState(settings.payout_ton_address ?? "");
	const save = useSaveSettings("Payout wallet saved");
	useEffect(
		() => setAddress(settings.payout_ton_address ?? ""),
		[settings.payout_ton_address],
	);
	const changed = address.trim() !== (settings.payout_ton_address ?? "");

	return (
		<Panel className="flex flex-col gap-3 p-5">
			<div>
				<h2 className="font-bold text-[14.5px]">Payout wallet</h2>
				<p className="mt-1 text-[12.5px] text-muted-foreground leading-relaxed">
					Payments through StarPay's bot are paid out to this TON wallet.
					Double-check it: payouts can't be reversed.
				</p>
			</div>
			<input
				aria-label="TON wallet address"
				value={address}
				onChange={(event) => setAddress(event.target.value)}
				placeholder="UQ… or EQ…"
				spellCheck={false}
				className={`${inputClass} font-mono`}
			/>
			<Button
				className="self-start"
				loading={save.isPending}
				disabled={!changed}
				onClick={() =>
					save.mutate({ payout_ton_address: address.trim() || null })
				}
			>
				Save
			</Button>
		</Panel>
	);
}

function PaySupport({ settings }: { settings: SettingsView }) {
	const [text, setText] = useState(settings.pay_support_text);
	const save = useSaveSettings("Support reply saved");
	useEffect(
		() => setText(settings.pay_support_text),
		[settings.pay_support_text],
	);

	return (
		<Panel className="flex flex-col gap-3 p-5">
			<div>
				<h2 className="font-bold text-[14.5px]">/paysupport reply</h2>
				<p className="mt-1 text-[12.5px] text-muted-foreground leading-relaxed">
					Telegram requires a support contact for payments. This text is sent
					when a buyer runs /paysupport in your bot.
				</p>
			</div>
			<textarea
				aria-label="/paysupport reply"
				rows={4}
				maxLength={4000}
				value={text}
				onChange={(event) => setText(event.target.value)}
				placeholder="Need help with a purchase? Reply here or email support@yourgame.com. We answer within 24 hours."
				className={`${inputClass} resize-y leading-relaxed`}
			/>
			<Button
				className="self-start"
				loading={save.isPending}
				disabled={text === settings.pay_support_text}
				onClick={() => save.mutate({ pay_support_text: text })}
			>
				Save
			</Button>
		</Panel>
	);
}

function Notifications({ settings }: { settings: SettingsView }) {
	const save = useSaveSettings("Saved");
	const items = [
		[
			"notify_payment",
			"Payment received",
			"Telegram message for every paid order",
		],
		[
			"notify_webhook_fail",
			"Webhook failures",
			"Alert after repeated failed deliveries",
		],
		["notify_sub_cancel", "Subscription cancelled", "When a subscriber leaves"],
		["notify_digest", "Daily digest", "Revenue summary every morning"],
	] as const;

	return (
		<Panel className="p-5">
			<h2 className="font-bold text-[14.5px]">Notifications</h2>
			<p className="mt-1 mb-2 text-[12.5px] text-muted-foreground">
				Preferences are saved now; alerts start sending in a later release.
			</p>
			{items.map(([key, label, detail]) => (
				<div
					key={key}
					className="flex items-center gap-4 border-border/60 border-t py-3 first-of-type:border-t-0"
				>
					<div className="min-w-0 flex-1">
						<div className="font-semibold text-[13.5px]">{label}</div>
						<div className="text-[12px] text-muted-foreground">{detail}</div>
					</div>
					<Toggle
						label={label}
						checked={settings[key]}
						disabled={save.isPending}
						onCheckedChange={(checked) => save.mutate({ [key]: checked })}
					/>
				</div>
			))}
		</Panel>
	);
}
