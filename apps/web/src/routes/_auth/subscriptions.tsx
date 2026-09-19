import { SubscriptionStatus } from "@starpay/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Repeat } from "lucide-react";
import { z } from "zod";

import {
  EmptyState,
  ErrorState,
  Eyebrow,
  GridRow,
  Mono,
  Panel,
  RowsSkeleton,
  Segmented,
  Shimmer,
  Star,
  StarAmount,
  StatusPill,
} from "@/components/kit";
import { formatDate, formatStars } from "@/lib/format";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/subscriptions")({
  validateSearch: z.object({ status: SubscriptionStatus.optional().catch(undefined) }),
  component: Subscriptions,
  staticData: { title: "Subscriptions", subtitle: "30-day Star subscriptions" },
});

const COLUMNS = "minmax(150px,1fr) minmax(130px,1fr) 110px 150px 110px";

function Subscriptions() {
  const { status } = Route.useSearch();
  const navigate = Route.useNavigate();
  const stats = useQuery(orpc.subscriptions.stats.queryOptions());
  const list = useQuery({
    ...orpc.subscriptions.list.queryOptions({ input: { status, limit: 50 } }),
    placeholderData: keepPreviousData,
  });

  const cards = stats.data
    ? [
        { label: "Active", value: formatStars(stats.data.active), note: "renewing every 30 days" },
        { label: "Cancelled", value: formatStars(stats.data.cancelled), note: "run out at period end" },
        {
          label: "Monthly Stars",
          value: (
            <>
              <Star /> {formatStars(stats.data.monthly_stars)}
            </>
          ),
          note: "if every active subscription renews",
        },
      ]
    : null;

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5">
        {cards
          ? cards.map((card) => (
              <Panel key={card.label} className="px-[18px] py-4">
                <Eyebrow>{card.label}</Eyebrow>
                <div className="mt-1.5 text-[26px] font-extrabold tracking-[-0.02em]">{card.value}</div>
                <div className="text-[12.5px] text-muted-foreground">{card.note}</div>
              </Panel>
            ))
          : Array.from({ length: 3 }, (_, index) => <Shimmer key={index} className="h-[104px] rounded-2xl" />)}
      </div>

      <Segmented
        label="Filter by status"
        value={status ?? "all"}
        onChange={(value) => navigate({ search: { status: value === "all" ? undefined : value } })}
        options={[
          { value: "all", label: "All" },
          { value: "active", label: "active" },
          { value: "cancelled", label: "cancelled" },
          { value: "expired", label: "expired" },
        ]}
      />

      <Panel>
        <div className="overflow-x-auto">
          <div role="table" aria-label="Subscriptions" className="min-w-[700px]">
            <GridRow header columns={COLUMNS}>
              <div>Subscriber</div>
              <div>Plan</div>
              <div>Price</div>
              <div>Renews / ends</div>
              <div>Status</div>
            </GridRow>
            {list.isPending ? (
              <RowsSkeleton />
            ) : list.isError ? (
              <ErrorState error={list.error} onRetry={() => list.refetch()} />
            ) : list.data.data.length === 0 ? (
              <EmptyState
                icon={<Repeat />}
                title={status ? `No ${status} subscriptions` : "No subscriptions yet"}
                action={
                  !status && (
                    <Link to="/products" className="text-[13px] font-semibold text-brand hover:underline">
                      Create a subscription product →
                    </Link>
                  )
                }
              >
                Buyers subscribe when they pay for a product of type "Subscription". Telegram renews it every 30 days.
              </EmptyState>
            ) : (
              list.data.data.map((subscription) => (
                <GridRow key={subscription.id} columns={COLUMNS}>
                  <div className="min-w-0">
                    <div className="truncate font-semibold">
                      {subscription.customer.username ? `@${subscription.customer.username}` : "Telegram user"}
                    </div>
                    <Mono className="text-[11.5px] text-faint">{subscription.customer.telegram_user_id}</Mono>
                  </div>
                  <div className="truncate">{subscription.product.name}</div>
                  <StarAmount stars={subscription.price} />
                  <Mono className="text-[#475467] dark:text-muted-foreground">
                    {subscription.status === "expired" ? "ended " : ""}
                    {formatDate(subscription.current_period_end)}
                  </Mono>
                  <div>
                    <StatusPill status={subscription.status} />
                  </div>
                </GridRow>
              ))
            )}
          </div>
        </div>
      </Panel>
    </>
  );
}
