import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Search, Users } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Avatar,
  Button,
  EmptyState,
  ErrorState,
  GridRow,
  inputClass,
  Mono,
  Panel,
  RowsSkeleton,
  StarAmount,
} from "@/components/kit";
import { initials, timeAgo } from "@/lib/format";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/customers")({
  component: Customers,
  staticData: { title: "Customers", subtitle: "Telegram users who have paid" },
});

const COLUMNS = "minmax(170px,1.3fr) 120px 90px 130px 100px";
const PAGE_SIZE = 25;

function Customers() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebounced(query.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  const customers = useQuery({
    ...orpc.customers.list.queryOptions({
      input: { q: debounced || undefined, limit: PAGE_SIZE, offset },
    }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-faint" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search @username or Telegram ID…"
          aria-label="Search customers"
          className={`${inputClass} pl-10`}
        />
      </div>
      <Panel>
        <div className="overflow-x-auto">
          <div role="table" aria-label="Customers" className="min-w-[680px]">
            <GridRow header columns={COLUMNS}>
              <div>Customer</div>
              <div>Total spent</div>
              <div>Orders</div>
              <div>Last payment</div>
              <div />
            </GridRow>
            {customers.isPending ? (
              <RowsSkeleton rows={7} />
            ) : customers.isError ? (
              <ErrorState error={customers.error} onRetry={() => customers.refetch()} />
            ) : customers.data.data.length === 0 ? (
              <EmptyState icon={<Users />} title={debounced ? "No matching customers" : "No customers yet"}>
                {debounced
                  ? "Try a different username or ID."
                  : "A Telegram user becomes a customer when they complete their first payment."}
              </EmptyState>
            ) : (
              customers.data.data.map((customer) => {
                const handle = customer.username ? `@${customer.username}` : null;
                return (
                  <GridRow key={customer.id} columns={COLUMNS}>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar text={initials(customer.username ?? customer.first_name)} />
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{handle ?? customer.first_name ?? "Telegram user"}</div>
                        <Mono className="text-[11.5px] text-faint">{customer.telegram_user_id}</Mono>
                      </div>
                    </div>
                    <StarAmount stars={customer.total_spent} />
                    <div>{customer.order_count}</div>
                    <div className="text-[12.5px] text-muted-foreground">{timeAgo(customer.last_payment_at)}</div>
                    <div>
                      <Link
                        to="/payments"
                        search={{ q: handle ?? String(customer.telegram_user_id) }}
                        className="rounded-lg border border-input px-2.5 py-1 text-[12px] font-semibold hover:bg-muted"
                      >
                        Orders
                      </Link>
                    </div>
                  </GridRow>
                );
              })
            )}
          </div>
        </div>
        {customers.data && customers.data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-5 py-3.5 text-[12.5px] text-muted-foreground">
            <div>
              {offset + 1}–{Math.min(offset + PAGE_SIZE, customers.data.total)} of {customers.data.total}
            </div>
            <div className="flex gap-1.5">
              <Button variant="secondary" size="sm" disabled={offset === 0} onClick={() => setOffset(offset - PAGE_SIZE)}>
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={offset + PAGE_SIZE >= customers.data.total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </>
  );
}
