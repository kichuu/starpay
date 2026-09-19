import { cn } from "@starpay/ui/lib/utils";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Wallet } from "lucide-react";

import {
  Button,
  EmptyState,
  ErrorState,
  Eyebrow,
  Mono,
  Panel,
  PanelHeader,
  RowsSkeleton,
  Shimmer,
  Star,
} from "@/components/kit";
import { formatStars, formatUsd, formatWhen, timeAgo } from "@/lib/format";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/balance")({
  component: Balance,
  staticData: { title: "Balance", subtitle: "Stars held in your bot" },
});

function Balance() {
  const bot = useQuery(orpc.bot.get.queryOptions());
  const balance = useQuery(orpc.balance.get.queryOptions());

  if (bot.data === null) {
    return (
      <Panel>
        <EmptyState
          icon={<Wallet />}
          title="No bot connected"
          action={
            <Link to="/bot" className="text-[13px] font-semibold text-brand hover:underline">
              Connect your bot →
            </Link>
          }
        >
          Stars are paid into your bot's balance on Telegram. Connect the bot to see it here.
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
            <p className="text-[13px] text-destructive">{balance.error.message}</p>
          ) : balance.data.stars === null ? (
            <div className="py-2 text-[13px] text-muted-foreground">Not synced yet. Telegram didn't return a balance.</div>
          ) : (
            <>
              <div className="flex items-baseline gap-2 text-[38px] font-extrabold tracking-[-0.03em]">
                <Star className="text-[28px]" />
                {formatStars(balance.data.stars)}
              </div>
              <div className="text-[13px] text-muted-foreground">≈ {formatUsd(balance.data.stars)} USD · estimate</div>
            </>
          )}
          <Mono className="mt-1 text-[11.5px] text-faint">
            synced from Telegram · {timeAgo(balance.data?.synced_at)}
          </Mono>
        </Panel>
        <Panel className="flex flex-col gap-2 border-brand-line bg-brand-soft px-6 py-5">
          <h2 className="text-[14.5px] font-bold">Withdrawals happen on Fragment</h2>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            StarPay never holds your funds. Stars stay in your bot's balance until you withdraw them yourself on
            Fragment, which pays out in TON. Telegram holds new Stars for a period before they become withdrawable.
          </p>
          <a
            href="https://fragment.com"
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 self-start text-[13px] font-semibold text-brand hover:underline"
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
      <PanelHeader title="Transaction history" description="Live from Telegram, newest first" />
      {transactions.isPending ? (
        <RowsSkeleton rows={6} />
      ) : transactions.isError ? (
        <ErrorState error={transactions.error} onRetry={() => transactions.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="No transactions yet">Payments, refunds and withdrawals appear here.</EmptyState>
      ) : (
        <>
          {rows.map((tx) => (
            <div
              key={tx.id}
              className="grid grid-cols-[120px_minmax(0,1fr)_110px] items-center gap-3 border-b border-border/60 px-5 py-3 text-[13.5px] last:border-b-0"
            >
              <Mono className="text-muted-foreground">{formatWhen(tx.date)}</Mono>
              <div className="truncate">
                {tx.order_id ? (
                  <Link to="/payments" search={{ order: tx.order_id }} className="hover:underline">
                    {tx.label}
                  </Link>
                ) : (
                  tx.label
                )}
              </div>
              <div
                className={cn(
                  "text-right font-bold whitespace-nowrap",
                  tx.amount >= 0 ? "text-[#067647] dark:text-[#47cd89]" : "text-[#B42318] dark:text-[#f97066]",
                )}
              >
                {tx.amount >= 0 ? "+" : "−"} ★ {formatStars(Math.abs(tx.amount))}
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
