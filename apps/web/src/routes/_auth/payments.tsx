import { OrderStatus } from "@starpay/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Receipt, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";

import {
  Button,
  EmptyState,
  ErrorState,
  GridRow,
  inputClass,
  Mono,
  Panel,
  RowsSkeleton,
  Segmented,
  StarAmount,
  StatusPill,
} from "@/components/kit";
import { OrderDrawer } from "@/components/order-drawer";
import { formatWhen } from "@/lib/format";
import { orpc } from "@/utils/orpc";

const searchSchema = z.object({
  status: OrderStatus.optional().catch(undefined),
  q: z.string().optional().catch(undefined),
  order: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_auth/payments")({
  validateSearch: searchSchema,
  component: Payments,
  staticData: { title: "Payments", subtitle: "Every invoice and its outcome" },
});

const STATUS_TABS = [
  { value: "all", label: "All" },
  { value: "created", label: "created" },
  { value: "pre_checkout", label: "pre-checkout" },
  { value: "paid", label: "paid" },
  { value: "refunded", label: "refunded" },
  { value: "expired", label: "expired" },
  { value: "failed", label: "failed" },
] as const;

const COLUMNS = "150px minmax(140px,1.4fr) minmax(130px,1fr) 110px 120px 130px";
const PAGE_SIZE = 20;

function Payments() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [query, setQuery] = useState(search.q ?? "");
  // Cursor stack: cursors[i] is the `starting_after` for page i.
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const page = cursors.length - 1;

  // Debounce typing into the URL.
  useEffect(() => {
    const handle = setTimeout(() => {
      if ((search.q ?? "") !== query) {
        navigate({ search: (prev) => ({ ...prev, q: query || undefined }), replace: true });
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query, search.q, navigate]);

  // New filters start from the first page.
  useEffect(() => {
    setCursors([undefined]);
  }, [search.status, search.q]);

  const orders = useQuery({
    ...orpc.orders.list.queryOptions({
      input: {
        status: search.status,
        q: search.q,
        limit: PAGE_SIZE,
        starting_after: cursors[page],
      },
    }),
    placeholderData: keepPreviousData,
  });

  const filtered = Boolean(search.status || search.q);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search order ID, @user, Telegram ID, charge ID or reference…"
            aria-label="Search payments"
            className={`${inputClass} pl-10`}
          />
        </div>
        <Segmented
          label="Filter by status"
          value={search.status ?? "all"}
          onChange={(value) =>
            navigate({ search: (prev) => ({ ...prev, status: value === "all" ? undefined : value }) })
          }
          options={STATUS_TABS}
        />
      </div>

      <Panel>
        <div className="overflow-x-auto">
          <div role="table" aria-label="Payments" className="min-w-[820px]">
            <GridRow header columns={COLUMNS}>
              <div>Order</div>
              <div>Product</div>
              <div>Telegram user</div>
              <div>Amount</div>
              <div>Status</div>
              <div>Created</div>
            </GridRow>
            {orders.isPending ? (
              <RowsSkeleton rows={8} />
            ) : orders.isError ? (
              <ErrorState error={orders.error} onRetry={() => orders.refetch()} />
            ) : orders.data.data.length === 0 ? (
              <EmptyState
                icon={<Receipt />}
                title={filtered ? "No matching payments" : "No payments yet"}
                action={
                  !filtered && (
                    <Link to="/bot" className="text-[13px] font-semibold text-brand hover:underline">
                      Create your first order →
                    </Link>
                  )
                }
              >
                {filtered
                  ? "Try another search or status."
                  : "Orders appear here when your server calls POST /v1/orders."}
              </EmptyState>
            ) : (
              orders.data.data.map((order) => (
                <GridRow
                  key={order.id}
                  columns={COLUMNS}
                  onClick={() => navigate({ search: (prev) => ({ ...prev, order: order.id }) })}
                >
                  <Mono className="truncate text-brand">{order.id}</Mono>
                  <div className="truncate font-semibold">{order.product.name}</div>
                  <div className="min-w-0">
                    <div className="truncate">
                      {order.customer?.username ? `@${order.customer.username}` : order.customer ? "—" : "not paid yet"}
                    </div>
                    <Mono className="text-[11.5px] text-faint">
                      {order.customer?.telegram_user_id ?? order.telegram_user_id ?? ""}
                    </Mono>
                  </div>
                  <StarAmount stars={order.amount} />
                  <div>
                    <StatusPill status={order.status} />
                  </div>
                  <Mono className="text-muted-foreground">{formatWhen(order.created_at)}</Mono>
                </GridRow>
              ))
            )}
          </div>
        </div>
        <div className="flex items-center justify-between px-5 py-3.5 text-[12.5px] text-muted-foreground">
          <div>Page {page + 1}</div>
          <div className="flex gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              disabled={page === 0}
              onClick={() => setCursors((stack) => stack.slice(0, -1))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!orders.data?.has_more}
              onClick={() => {
                const last = orders.data?.data.at(-1)?.id;
                if (last) setCursors((stack) => [...stack, last]);
              }}
            >
              Next
            </Button>
          </div>
        </div>
      </Panel>

      <OrderDrawer
        orderId={search.order}
        onClose={() => navigate({ search: (prev) => ({ ...prev, order: undefined }) })}
      />
    </>
  );
}
