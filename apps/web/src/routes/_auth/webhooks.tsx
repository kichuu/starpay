import { type WebhookEndpointView, WebhookEventType } from "@starpay/contracts";
import { cn } from "@starpay/ui/lib/utils";
import {
	keepPreviousData,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Send, Webhook, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import {
	Button,
	CopyButton,
	DataRow,
	DataTable,
	Dialog,
	Drawer,
	DrawerClose,
	EmptyState,
	ErrorState,
	Field,
	inputClass,
	Mono,
	Panel,
	PanelHeader,
	Pill,
	RowsSkeleton,
} from "@/components/kit";
import { formatWhen, timeAgo } from "@/lib/format";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/webhooks")({
	validateSearch: z.object({
		delivery: z.string().optional().catch(undefined),
		status: z
			.enum(["pending", "succeeded", "failed"])
			.optional()
			.catch(undefined),
	}),
	component: Webhooks,
	staticData: { title: "Webhooks", subtitle: "Deliveries to your server" },
});

function Webhooks() {
	return (
		<>
			<Endpoints />
			<Deliveries />
		</>
	);
}

// ── Endpoints ──

function Endpoints() {
	const endpoints = useQuery(orpc.webhooks.endpoints.list.queryOptions());
	const [editing, setEditing] = useState<WebhookEndpointView | "new" | null>(
		null,
	);

	return (
		<>
			<Panel>
				<PanelHeader
					title="Endpoints"
					description="StarPay POSTs each event here, signed, and retries five times over about eight hours."
					action={
						<Button onClick={() => setEditing("new")}>Add endpoint</Button>
					}
				/>
				{endpoints.isPending ? (
					<RowsSkeleton rows={2} />
				) : endpoints.isError ? (
					<ErrorState
						error={endpoints.error}
						onRetry={() => endpoints.refetch()}
					/>
				) : endpoints.data.length === 0 ? (
					<EmptyState
						icon={<Webhook />}
						title="No endpoints yet"
						action={
							<Button onClick={() => setEditing("new")}>
								Add your first endpoint
							</Button>
						}
					>
						Add your server's URL and StarPay will tell it about every payment,
						refund and subscription change, so you don't have to poll.
					</EmptyState>
				) : (
					endpoints.data.map((endpoint) => (
						<EndpointRow
							key={endpoint.id}
							endpoint={endpoint}
							onEdit={() => setEditing(endpoint)}
						/>
					))
				)}
			</Panel>
			{/* Keyed so the event checkboxes reset when a different endpoint is opened. */}
			<EndpointDialog
				key={editing === "new" ? "new" : (editing?.id ?? "none")}
				editing={editing}
				onClose={() => setEditing(null)}
			/>
		</>
	);
}

function EndpointRow({
	endpoint,
	onEdit,
}: {
	endpoint: WebhookEndpointView;
	onEdit: () => void;
}) {
	const queryClient = useQueryClient();
	const [secret, setSecret] = useState<string | null>(null);
	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: orpc.webhooks.key() });

	const reveal = useMutation(
		orpc.webhooks.endpoints.revealSecret.mutationOptions({
			onSuccess: (data) => setSecret(data.secret),
		}),
	);
	const rotate = useMutation(
		orpc.webhooks.endpoints.rotateSecret.mutationOptions({
			onSuccess: (data) => {
				setSecret(data.secret);
				toast.success(
					"Secret rotated. The old one keeps working for 24 hours.",
				);
				invalidate();
			},
		}),
	);
	const sendTest = useMutation(
		orpc.webhooks.endpoints.sendTest.mutationOptions({
			onSuccess: (result) => {
				if (result.succeeded)
					toast.success(
						`Test event delivered · ${result.status_code} in ${result.latency_ms} ms`,
					);
				else toast.error(`Test event failed · ${result.error}`);
				invalidate();
			},
		}),
	);

	return (
		<div className="flex flex-col gap-3 border-border/60 border-b px-5 py-4 last:border-b-0">
			<div className="flex flex-wrap items-center gap-3">
				<Mono className="min-w-0 flex-1 truncate text-[13px]">
					{endpoint.url}
				</Mono>
				<Pill tone={endpoint.status === "active" ? "success" : "muted"}>
					{endpoint.status}
				</Pill>
				<Button
					variant="secondary"
					size="sm"
					loading={sendTest.isPending}
					onClick={() =>
						sendTest.mutate({ id: endpoint.id, type: "payment.succeeded" })
					}
				>
					<Send /> Send test
				</Button>
				<Button variant="ghost" size="sm" onClick={onEdit}>
					Edit
				</Button>
			</div>
			<div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
				{endpoint.description && <span>{endpoint.description} ·</span>}
				<span>
					{endpoint.events.length === 0
						? "all events"
						: `${endpoint.events.length} event types`}
				</span>
				{endpoint.last_failure_at && (
					<span className="text-[#B42318] dark:text-[#f97066]">
						· last failure {timeAgo(endpoint.last_failure_at)}
					</span>
				)}
			</div>
			{endpoint.events.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{endpoint.events.map((event) => (
						<span
							key={event}
							className="rounded-full bg-muted px-2.5 py-1 font-mono text-[11.5px]"
						>
							{event}
						</span>
					))}
				</div>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-[12.5px] text-muted-foreground">
					Signing secret
				</span>
				{secret ? (
					<>
						<Mono className="rounded-lg bg-muted px-2.5 py-1">{secret}</Mono>
						<CopyButton value={secret} />
					</>
				) : (
					<Mono className="rounded-lg bg-muted px-2.5 py-1">
						whsec_••••••••••••••••
					</Mono>
				)}
				{!secret && (
					<Button
						variant="ghost"
						size="sm"
						loading={reveal.isPending}
						onClick={() => reveal.mutate({ id: endpoint.id })}
					>
						Reveal
					</Button>
				)}
				<Button
					variant="ghost"
					size="sm"
					loading={rotate.isPending}
					onClick={() => rotate.mutate({ id: endpoint.id })}
				>
					Rotate
				</Button>
			</div>
		</div>
	);
}

function EndpointDialog({
	editing,
	onClose,
}: {
	editing: WebhookEndpointView | "new" | null;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const endpoint = editing === "new" ? null : editing;
	const [events, setEvents] = useState<string[]>(endpoint?.events ?? []);
	const done = (message: string) => {
		toast.success(message);
		queryClient.invalidateQueries({ queryKey: orpc.webhooks.key() });
		onClose();
	};
	const create = useMutation(
		orpc.webhooks.endpoints.create.mutationOptions({
			onSuccess: () => done("Endpoint added"),
		}),
	);
	const update = useMutation(
		orpc.webhooks.endpoints.update.mutationOptions({
			onSuccess: () => done("Endpoint saved"),
		}),
	);
	const remove = useMutation(
		orpc.webhooks.endpoints.delete.mutationOptions({
			onSuccess: () => done("Endpoint removed"),
		}),
	);

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		const values = {
			url: String(form.get("url") ?? "").trim(),
			description: String(form.get("description") ?? "").trim() || undefined,
			events: events as typeof WebhookEventType.options,
		};
		if (endpoint) update.mutate({ id: endpoint.id, ...values });
		else create.mutate(values);
	}

	return (
		<Dialog
			open={editing !== null}
			onOpenChange={(open) => !open && onClose()}
			title={endpoint ? "Edit endpoint" : "Add endpoint"}
			description="Must be a public HTTPS URL. In Test mode, http and localhost are allowed."
		>
			<form
				key={endpoint?.id ?? "new"}
				onSubmit={onSubmit}
				className="flex flex-col gap-4"
			>
				<Field label="URL" htmlFor="endpoint-url">
					<input
						id="endpoint-url"
						name="url"
						type="url"
						required
						defaultValue={endpoint?.url}
						placeholder="https://api.yourgame.com/starpay/webhook"
						className={`${inputClass} font-mono`}
					/>
				</Field>
				<Field label="Description (optional)" htmlFor="endpoint-description">
					<input
						id="endpoint-description"
						name="description"
						maxLength={200}
						defaultValue={endpoint?.description ?? ""}
						className={inputClass}
					/>
				</Field>
				<fieldset className="flex flex-col gap-2">
					<legend className="mb-1 font-semibold text-[13px]">Events</legend>
					<p className="text-[12px] text-muted-foreground">
						Select none to receive everything.
					</p>
					<div className="grid gap-1.5 sm:grid-cols-2">
						{WebhookEventType.options.map((type) => (
							<label
								key={type}
								className="flex cursor-pointer items-center gap-2 font-mono text-[12.5px]"
							>
								<input
									type="checkbox"
									checked={events.includes(type)}
									onChange={(event) =>
										setEvents((current) =>
											event.target.checked
												? [...current, type]
												: current.filter((value) => value !== type),
										)
									}
									className="size-4 accent-[#0057FF]"
								/>
								{type}
							</label>
						))}
					</div>
				</fieldset>
				<div className="mt-1 flex flex-wrap items-center justify-between gap-2">
					{endpoint ? (
						<div className="flex gap-2">
							<Button
								variant="secondary"
								onClick={() =>
									update.mutate({
										id: endpoint.id,
										status:
											endpoint.status === "active" ? "disabled" : "active",
									})
								}
							>
								{endpoint.status === "active" ? "Disable" : "Enable"}
							</Button>
							<Button
								variant="danger"
								loading={remove.isPending}
								onClick={() => remove.mutate({ id: endpoint.id })}
							>
								Delete
							</Button>
						</div>
					) : (
						<span />
					)}
					<div className="flex gap-2">
						<Button variant="secondary" onClick={onClose}>
							Cancel
						</Button>
						<Button
							type="submit"
							loading={create.isPending || update.isPending}
						>
							{endpoint ? "Save" : "Add endpoint"}
						</Button>
					</div>
				</div>
			</form>
		</Dialog>
	);
}

// ── Delivery log ──

const DELIVERY_COLUMNS = "130px minmax(150px,1fr) 90px 80px 90px 110px";

function StatusPill({ status, code }: { status: string; code: number | null }) {
	const tone =
		status === "succeeded"
			? "success"
			: status === "failed"
				? "danger"
				: "warning";
	return <Pill tone={tone}>{code ?? status}</Pill>;
}

function Deliveries() {
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const deliveries = useQuery({
		...orpc.webhooks.deliveries.list.queryOptions({
			input: { status: search.status, limit: 25 },
		}),
		placeholderData: keepPreviousData,
		refetchInterval: 15_000,
	});

	return (
		<>
			<Panel>
				<PanelHeader
					title="Delivery log"
					description="Every attempt, with the request and the response"
					action={
						<div className="flex gap-1.5">
							{(["all", "succeeded", "pending", "failed"] as const).map(
								(status) => (
									<Button
										key={status}
										variant={
											(search.status ?? "all") === status
												? "primary"
												: "secondary"
										}
										size="sm"
										onClick={() =>
											navigate({
												search: (prev) => ({
													...prev,
													status: status === "all" ? undefined : status,
												}),
											})
										}
									>
										{status}
									</Button>
								),
							)}
						</div>
					}
				/>
				<DataTable
					label="Deliveries"
					columns={DELIVERY_COLUMNS}
					className="min-w-[760px]"
					head={["Time", "Event", "Status", "Attempt", "Latency", "Endpoint"]}
					state={
						deliveries.isPending ? (
							<RowsSkeleton rows={5} />
						) : deliveries.isError ? (
							<ErrorState
								error={deliveries.error}
								onRetry={() => deliveries.refetch()}
							/>
						) : deliveries.data.data.length === 0 ? (
							<EmptyState title="Nothing delivered yet">
								Events show up here as soon as a payment happens.
							</EmptyState>
						) : undefined
					}
				>
					{deliveries.data?.data.map((delivery) => (
						<DataRow
							key={delivery.id}
							onClick={() =>
								navigate({
									search: (prev) => ({ ...prev, delivery: delivery.id }),
								})
							}
						>
							<Mono className="text-muted-foreground">
								{formatWhen(delivery.created_at)}
							</Mono>
							<div className="min-w-0">
								<div className="truncate font-semibold">
									{delivery.event_type}
								</div>
								<Mono className="block truncate text-[11.5px] text-faint">
									{delivery.order_id ?? delivery.event_id}
								</Mono>
							</div>
							<StatusPill
								status={delivery.status}
								code={delivery.last_status_code}
							/>
							<div>
								{delivery.attempts} / {delivery.max_attempts}
							</div>
							<Mono className="text-muted-foreground">
								{delivery.last_latency_ms === null
									? "—"
									: `${delivery.last_latency_ms} ms`}
							</Mono>
							<Mono className="truncate text-muted-foreground">
								{new URL(delivery.endpoint_url).host}
							</Mono>
						</DataRow>
					))}
				</DataTable>
			</Panel>
			<DeliveryDrawer
				id={search.delivery}
				onClose={() =>
					navigate({ search: (prev) => ({ ...prev, delivery: undefined }) })
				}
			/>
		</>
	);
}

function DeliveryDrawer({
	id,
	onClose,
}: {
	id: string | undefined;
	onClose: () => void;
}) {
	return (
		<Drawer
			open={Boolean(id)}
			onOpenChange={(open) => !open && onClose()}
			title="Delivery"
			className="max-w-[640px]"
		>
			{id && <DeliveryDetail id={id} />}
		</Drawer>
	);
}

function Block({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div>
			<h4 className="mb-1.5 font-semibold text-[11.5px] text-muted-foreground uppercase tracking-[0.04em]">
				{title}
			</h4>
			{children}
		</div>
	);
}

function Code({ children }: { children: React.ReactNode }) {
	return (
		<pre className="overflow-x-auto rounded-xl bg-[#0B1B2B] p-3.5 font-mono text-[#CFE0FF] text-[11.5px] leading-relaxed">
			{children}
		</pre>
	);
}

const formatHeaders = (headers: Record<string, string>) =>
	Object.entries(headers)
		.map(([key, value]) => `${key}: ${value}`)
		.join("\n");

function pretty(body: string | null) {
	if (!body) return "(empty)";
	try {
		return JSON.stringify(JSON.parse(body), null, 2);
	} catch {
		return body;
	}
}

function DeliveryDetail({ id }: { id: string }) {
	const queryClient = useQueryClient();
	const detail = useQuery(
		orpc.webhooks.deliveries.get.queryOptions({ input: { id } }),
	);
	const resend = useMutation(
		orpc.webhooks.deliveries.resend.mutationOptions({
			onSuccess: () => {
				toast.success("Queued again; it sends within a few seconds");
				queryClient.invalidateQueries({ queryKey: orpc.webhooks.key() });
			},
		}),
	);

	const delivery = detail.data?.delivery;
	return (
		<>
			<div className="flex items-start justify-between gap-4 border-border border-b px-6 py-5">
				<div className="min-w-0">
					<Mono className="text-muted-foreground">{id}</Mono>
					<div className="mt-1 truncate font-extrabold text-lg tracking-[-0.02em]">
						{delivery?.event_type ?? " "}
					</div>
				</div>
				<DrawerClose
					aria-label="Close"
					className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
				>
					<X className="size-4" />
				</DrawerClose>
			</div>
			<div className="flex-1 overflow-y-auto">
				{detail.isPending ? (
					<RowsSkeleton rows={5} />
				) : detail.isError ? (
					<ErrorState error={detail.error} onRetry={() => detail.refetch()} />
				) : (
					delivery && (
						<div className="flex flex-col gap-6 px-6 py-5">
							<div className="flex flex-wrap items-center gap-3">
								<StatusPill
									status={delivery.status}
									code={delivery.last_status_code}
								/>
								<Mono className="text-[12.5px]">{delivery.endpoint_url}</Mono>
							</div>
							<dl className="flex flex-col divide-y divide-border rounded-xl border border-border text-[13px]">
								{[
									["Event", delivery.event_id],
									["Order", delivery.order_id ?? "—"],
									[
										"Attempts",
										`${delivery.attempts} of ${delivery.max_attempts}`,
									],
									[
										"Next attempt",
										delivery.next_attempt_at
											? formatWhen(delivery.next_attempt_at)
											: "—",
									],
									[
										"Delivered",
										delivery.delivered_at
											? formatWhen(delivery.delivered_at)
											: "—",
									],
									["Last error", delivery.last_error ?? "—"],
								].map(([label, value]) => (
									<div
										key={label}
										className="flex justify-between gap-4 px-4 py-2.5"
									>
										<dt className="text-muted-foreground">{label}</dt>
										<dd className="truncate font-medium">{value}</dd>
									</div>
								))}
							</dl>

							{delivery.order_id && (
								<Link
									to="/payments"
									search={{ order: delivery.order_id }}
									className="font-semibold text-[13px] text-brand hover:underline"
								>
									Open the order →
								</Link>
							)}

							{detail.data.attempts.map((attempt) => (
								<section key={attempt.attempt} className="flex flex-col gap-3">
									<div className="flex items-center justify-between gap-2">
										<h3 className="font-bold text-[14px]">
											Attempt {attempt.attempt}
										</h3>
										<div className="flex items-center gap-2 text-[12px] text-muted-foreground">
											<span>{formatWhen(attempt.created_at)}</span>
											<span>· {attempt.latency_ms} ms</span>
											<Pill tone={attempt.error ? "danger" : "success"}>
												{attempt.status_code ?? "no response"}
											</Pill>
										</div>
									</div>
									{attempt.error && (
										<div className="rounded-lg border border-[#FDA29B] bg-[#FEF3F2] px-3 py-2 text-[#B42318] text-[12.5px] dark:border-[#7a2a24] dark:bg-[#2a1215] dark:text-[#f97066]">
											{attempt.error}
										</div>
									)}
									<Block title={`Request · POST ${attempt.url}`}>
										<Code>{formatHeaders(attempt.request_headers)}</Code>
									</Block>
									<Block title="Request body">
										<Code>{pretty(attempt.request_body)}</Code>
									</Block>
									{attempt.status_code !== null && (
										<>
											<Block title="Response headers">
												<Code>{formatHeaders(attempt.response_headers)}</Code>
											</Block>
											<Block title="Response body">
												<Code>{pretty(attempt.response_body)}</Code>
											</Block>
										</>
									)}
								</section>
							))}

							<Button
								variant="secondary"
								className={cn(
									"w-full",
									detail.data.attempts.length === 0 && "hidden",
								)}
								loading={resend.isPending}
								onClick={() => resend.mutate({ id })}
							>
								Resend this event
							</Button>
						</div>
					)
				)}
			</div>
		</>
	);
}
