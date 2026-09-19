import { OverviewRange, type OverviewResult } from "@starpay/contracts";
import { cn } from "@starpay/ui/lib/utils";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { z } from "zod";

import {
  EmptyState,
  ErrorState,
  Eyebrow,
  Mono,
  Panel,
  PanelHeader,
  RowsSkeleton,
  Segmented,
  Shimmer,
  Star,
  StarAmount,
  StatusPill,
} from "@/components/kit";
import { type ChartBar, StarsChart } from "@/components/stars-chart";
import { formatStars, formatUsd, timeAgo } from "@/lib/format";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/")({
  validateSearch: z.object({ range: OverviewRange.optional().catch(undefined) }),
  component: Overview,
  staticData: { title: "Overview", subtitle: "How your bot is earning" },
});

const RANGES = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
] as const;

const RANGE_LABEL = { today: "today", "7d": "last 7 days", "30d": "last 30 days" } as const;
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

function toBars(data: OverviewResult): ChartBar[] {
  return data.series.map((point) => {
    if (data.range === "today") {
      const end = String(Number(point.label) + 4).padStart(2, "0");
      return { key: point.label, label: point.label, tooltip: `${point.label}:00–${end}:00`, stars: point.stars };
    }
    const date = new Date(`${point.label}T00:00:00`);
    return {
      key: point.label,
      label:
        data.range === "7d"
          ? date.toLocaleDateString("en-GB", { weekday: "short" })
          : date.toLocaleDateString("en-GB", { day: "numeric" }),
      tooltip: date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }),
      stars: point.stars,
    };
  });
}

function delta(current: number, previous: number): string | null {
  if (previous === 0) return current > 0 ? "New revenue" : null;
  const ratio = current / previous;
  // A near-empty previous period makes percentages meaningless ("+19940%").
  if (ratio >= 10) return `${Math.floor(ratio)}× the previous period`;
  const change = Math.round((ratio - 1) * 100);
  return `${change >= 0 ? "+" : ""}${change}% vs previous period`;
}

function Overview() {
  const { range = "7d" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const overview = useQuery({
    ...orpc.overview.get.queryOptions({ input: { range, tz: TIME_ZONE } }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <Onboarding />
      <Segmented
        label="Date range"
        value={range}
        onChange={(value) => navigate({ search: { range: value } })}
        options={RANGES}
      />
      {overview.isError ? (
        <Panel>
          <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
        </Panel>
      ) : (
        <Dashboard data={overview.data} range={range} refreshing={overview.isPlaceholderData} />
      )}
    </>
  );
}

function Dashboard({
  data,
  range,
  refreshing,
}: {
  data: OverviewResult | undefined;
  range: OverviewRange;
  refreshing: boolean;
}) {
  const conversion =
    data && data.conversion.created > 0
      ? Math.round((data.conversion.paid / data.conversion.created) * 100)
      : null;

  return (
    <>
      <div className={cn("grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3.5", refreshing && "opacity-60")}>
        <div className="flex flex-col gap-1.5 rounded-2xl bg-brand px-5 py-[18px] text-white">
          <Eyebrow className="text-[#CFE0FF]">Stars revenue · {RANGE_LABEL[range]}</Eyebrow>
          {data ? (
            <>
              <div className="flex items-baseline gap-2 text-[30px] font-extrabold tracking-[-0.03em]">
                <span aria-hidden className="text-[23px] text-star-bright">
                  ★
                </span>
                {formatStars(data.revenue.stars)}
              </div>
              <div className="text-[12.5px] text-[#DCE8FF]">
                ≈ {formatUsd(data.revenue.stars)} <span className="text-[#A9C6FF]">· estimate, not a settlement rate</span>
              </div>
              {delta(data.revenue.stars, data.revenue.previous) && (
                <div className="mt-0.5 text-[12.5px] font-semibold text-[#B9FFDC]">
                  {delta(data.revenue.stars, data.revenue.previous)}
                </div>
              )}
            </>
          ) : (
            <Shimmer className="h-9 w-32 bg-white/20" />
          )}
        </div>

        <Panel className="flex flex-col gap-1.5 px-5 py-[18px]">
          <Eyebrow>Payments</Eyebrow>
          {data ? (
            <>
              <div className="text-[30px] font-extrabold tracking-[-0.03em]">{formatStars(data.payments.count)}</div>
              <div className="text-[12.5px] text-muted-foreground">
                <Star /> {formatStars(data.payments.average)} average order
              </div>
            </>
          ) : (
            <Shimmer className="h-9 w-20" />
          )}
        </Panel>

        <Panel className="flex flex-col gap-2 px-5 py-[18px]">
          <Eyebrow>Conversion</Eyebrow>
          {data ? (
            <>
              <div className="text-[30px] font-extrabold tracking-[-0.03em]">
                {conversion === null ? "—" : `${conversion}%`}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-brand" style={{ width: `${conversion ?? 0}%` }} />
              </div>
              <div className="text-[12.5px] text-muted-foreground">
                {data.conversion.created} invoices created → {data.conversion.paid} paid
              </div>
            </>
          ) : (
            <Shimmer className="h-9 w-20" />
          )}
        </Panel>

        <Panel
          className={cn(
            "flex flex-col gap-1.5 px-5 py-[18px]",
            data?.deliveries.failed && "border-[#FFD9D4] dark:border-[#7a2a24]",
          )}
        >
          <Eyebrow className={data?.deliveries.failed ? "text-[#B42318] dark:text-[#f97066]" : undefined}>
            Failed webhooks
          </Eyebrow>
          {data ? (
            <>
              <div
                className={cn(
                  "text-[30px] font-extrabold tracking-[-0.03em]",
                  data.deliveries.failed > 0 && "text-[#B42318] dark:text-[#f97066]",
                )}
              >
                {data.deliveries.failed}
              </div>
              <div className="text-[12.5px] text-muted-foreground">
                {data.deliveries.pending} event{data.deliveries.pending === 1 ? "" : "s"} waiting to send
              </div>
              <Link to="/webhooks" className="mt-1 text-[12.5px] font-semibold text-brand hover:underline">
                Open delivery log →
              </Link>
            </>
          ) : (
            <Shimmer className="h-9 w-12" />
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3.5">
        <Panel className="p-5">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-[14.5px] font-bold">Stars collected</h2>
            <Mono className="text-muted-foreground">{RANGE_LABEL[range]}</Mono>
          </div>
          {data ? (
            <StarsChart bars={toBars(data)} dimmed={refreshing} />
          ) : (
            <Shimmer className="h-[170px] w-full" />
          )}
        </Panel>
        <BotHealth pendingDeliveries={data?.deliveries.pending} />
      </div>

      <Panel>
        <PanelHeader
          title="Latest payments"
          action={
            <Link to="/payments" className="text-[13px] font-semibold text-brand hover:underline">
              View all
            </Link>
          }
        />
        {!data ? (
          <RowsSkeleton rows={5} />
        ) : data.recent.length === 0 ? (
          <EmptyState title="No orders yet">Orders show up here as soon as your server creates them.</EmptyState>
        ) : (
          data.recent.map((order) => (
            <Link
              key={order.id}
              to="/payments"
              search={{ order: order.id }}
              className="flex items-center gap-3.5 border-b border-border/60 px-5 py-3 outline-none last:border-b-0 hover:bg-row-hover focus-visible:bg-row-hover"
            >
              <Mono className="w-[120px] shrink-0 truncate text-[#475467] dark:text-muted-foreground">{order.id}</Mono>
              <div className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{order.product.name}</div>
              <Mono className="hidden text-[13px] text-[#475467] sm:inline dark:text-muted-foreground">
                {order.customer?.username ? `@${order.customer.username}` : ""}
              </Mono>
              <StarAmount stars={order.amount} className="text-[13.5px]" />
              <StatusPill status={order.status} />
            </Link>
          ))
        )}
      </Panel>
    </>
  );
}

function BotHealth({ pendingDeliveries }: { pendingDeliveries: number | undefined }) {
  const bot = useQuery(orpc.bot.get.queryOptions());
  const rows: { label: string; detail: string; state: string; tone: "ok" | "warn" | "bad" }[] = [];

  if (bot.data) {
    const view = bot.data;
    rows.push(
      {
        label: "Telegram webhook",
        detail: view.last_webhook_error ?? `@${view.username}`,
        state: view.status === "active" ? "OK" : view.status === "invalid_token" ? "Token rejected" : "Failing",
        tone: view.status === "active" ? "ok" : "bad",
      },
      {
        label: "Last Telegram update",
        detail: view.last_update_at
          ? `${view.last_update_type ?? "update"} · ${timeAgo(view.last_update_at)}`
          : "No updates received yet",
        state: view.last_update_at ? "OK" : "Waiting",
        tone: view.last_update_at ? "ok" : "warn",
      },
      {
        label: "Pending Telegram updates",
        detail: "Updates Telegram is still trying to deliver",
        state: String(view.pending_updates),
        tone: view.pending_updates > 0 ? "warn" : "ok",
      },
    );
  }
  rows.push({
    label: "Webhook events queued",
    detail: "Events waiting to be sent to your server",
    state: String(pendingDeliveries ?? 0),
    tone: (pendingDeliveries ?? 0) > 0 ? "warn" : "ok",
  });

  const DOT = { ok: "bg-[#12B76A]", warn: "bg-[#F79009]", bad: "bg-[#F04438]" };
  const TEXT = { ok: "text-[#067647] dark:text-[#47cd89]", warn: "text-[#B54708] dark:text-[#fdb022]", bad: "text-[#B42318] dark:text-[#f97066]" };

  return (
    <Panel className="flex flex-col p-5">
      <h2 className="mb-2 text-[14.5px] font-bold">Bot health</h2>
      {bot.isPending ? (
        <RowsSkeleton rows={3} />
      ) : !bot.data ? (
        <EmptyState
          className="py-8"
          title="No bot connected"
          action={
            <Link to="/bot" className="text-[13px] font-semibold text-brand hover:underline">
              Connect your bot →
            </Link>
          }
        >
          StarPay needs your Telegram bot to create invoices and receive payments.
        </EmptyState>
      ) : (
        rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3 border-t border-border/60 py-[11px] first:border-t-0">
            <span className={cn("size-2 shrink-0 rounded-full", DOT[row.tone])} />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold">{row.label}</div>
              <div className="truncate font-mono text-[12px] text-muted-foreground">{row.detail}</div>
            </div>
            <div className={cn("text-[12px] font-semibold", TEXT[row.tone])}>{row.state}</div>
          </div>
        ))
      )}
    </Panel>
  );
}

function Onboarding() {
  const status = useQuery(orpc.onboarding.status.queryOptions());
  if (!status.data) return null;
  const steps = [
    { done: status.data.bot_connected, label: "Connect your Telegram bot", to: "/bot" },
    { done: status.data.has_product, label: "Add a product", to: "/products" },
    { done: status.data.has_api_key, label: "Create an API key", to: "/bot" },
    { done: status.data.has_paid_order, label: "Take a test payment", to: "/bot" },
  ] as const;
  if (steps.every((step) => step.done)) return null;
  const doneCount = steps.filter((step) => step.done).length;

  return (
    <Panel className="p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[14.5px] font-bold">Get set up</h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            Four steps to your first Stars payment. Use Test mode while you build.
          </p>
        </div>
        <Mono className="text-muted-foreground">
          {doneCount} / {steps.length}
        </Mono>
      </div>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => (
          <li key={step.label}>
            <Link
              to={step.to}
              className={cn(
                "flex h-full items-center gap-3 rounded-xl border px-3.5 py-3 text-[13px] font-semibold transition-colors",
                step.done
                  ? "border-border text-muted-foreground"
                  : "border-brand-line bg-brand-soft/60 text-foreground hover:bg-brand-soft",
              )}
            >
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-bold",
                  step.done ? "bg-[#12B76A] text-white" : "bg-card text-brand ring-1 ring-brand-line",
                )}
              >
                {step.done ? <Check className="size-3.5" /> : index + 1}
              </span>
              <span className={step.done ? "line-through decoration-1" : undefined}>{step.label}</span>
            </Link>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
