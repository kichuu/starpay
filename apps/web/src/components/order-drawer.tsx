import type { OrderDetail } from "@starpay/contracts";
import { cn } from "@starpay/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  Button,
  CopyButton,
  Drawer,
  DrawerClose,
  ErrorState,
  Mono,
  RowsSkeleton,
  Star,
  StatusPill,
} from "@/components/kit";
import { formatStars, formatUsd, formatWhen } from "@/lib/format";
import { orpc } from "@/utils/orpc";

type TimelineStep = { label: string; time: string | null; state: "done" | "pending" | "bad" };

const REJECT_REASONS: Record<string, string> = {
  expired: "invoice expired",
  wrongPayer: "different Telegram user",
  mismatch: "amount mismatch",
  unavailable: "product archived",
  alreadyPaid: "already paid",
};

function timeline(detail: OrderDetail): TimelineStep[] {
  const steps: TimelineStep[] = detail.timeline.map((entry) => {
    const data = entry.data as Record<string, unknown>;
    const time = formatWhen(entry.created_at);
    switch (entry.type) {
      case "created":
        return { label: "Invoice created", time, state: "done" };
      case "pre_checkout_approved":
        return { label: "Pre-checkout approved", time, state: "done" };
      case "pre_checkout_rejected":
        return {
          label: `Pre-checkout rejected · ${REJECT_REASONS[String(data.reason)] ?? String(data.reason)}`,
          time,
          state: "bad",
        };
      case "paid":
        return {
          label: data.late_payment ? "Payment successful (after expiry)" : "Payment successful",
          time,
          state: "done",
        };
      case "refunded":
        return { label: "Refunded", time, state: "done" };
      case "expired":
        return { label: data.reason === "cancelled" ? "Cancelled" : "Expired", time, state: "bad" };
      case "subscription_renewed":
        return { label: "Subscription renewed", time, state: "done" };
      default:
        return { label: entry.type, time, state: "done" };
    }
  });
  const status = detail.order.status;
  if (status === "created" || status === "pre_checkout") {
    steps.push({ label: "Waiting for payment", time: null, state: "pending" });
  }
  return steps;
}

const DOT = { done: "bg-[#12B76A]", pending: "bg-[#D0D5DD] dark:bg-[#2a3a57]", bad: "bg-[#F04438]" };

export function OrderDrawer({ orderId, onClose }: { orderId: string | undefined; onClose: () => void }) {
  return (
    <Drawer open={Boolean(orderId)} onOpenChange={(open) => !open && onClose()} title="Order details">
      {orderId && <OrderDrawerBody orderId={orderId} />}
    </Drawer>
  );
}

function OrderDrawerBody({ orderId }: { orderId: string }) {
  const queryClient = useQueryClient();
  const detail = useQuery(orpc.orders.get.queryOptions({ input: { id: orderId } }));
  const [confirmRefund, setConfirmRefund] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: orpc.orders.key() });
    queryClient.invalidateQueries({ queryKey: orpc.overview.key() });
    queryClient.invalidateQueries({ queryKey: orpc.customers.key() });
  };
  const refund = useMutation(
    orpc.orders.refund.mutationOptions({
      onSuccess: () => {
        toast.success("Refunded. Stars were returned to the buyer.");
        setConfirmRefund(false);
        invalidate();
      },
    }),
  );
  const cancel = useMutation(
    orpc.orders.cancel.mutationOptions({
      onSuccess: () => {
        toast.success("Order cancelled");
        invalidate();
      },
    }),
  );

  const order = detail.data?.order;
  const buyer = order?.customer
    ? `${order.customer.username ? `@${order.customer.username}` : "Telegram user"} · ${order.customer.telegram_user_id}`
    : order?.telegram_user_id
      ? `Only ${order.telegram_user_id} can pay`
      : "Anyone with the link";

  return (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
        <div className="min-w-0">
          <Mono className="text-muted-foreground">{orderId}</Mono>
          <div className="mt-1 truncate text-lg font-extrabold tracking-[-0.02em]">
            {order?.product.name ?? " "}
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
          <RowsSkeleton rows={6} />
        ) : detail.isError ? (
          <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
        ) : (
          order && (
            <div className="flex flex-col gap-6 px-6 py-5">
              <div className="flex flex-wrap items-center gap-3">
                <StatusPill status={order.status} />
                <div className="text-2xl font-extrabold tracking-[-0.02em]">
                  <Star /> {formatStars(order.amount)}
                </div>
                <div className="text-[12.5px] text-muted-foreground">≈ {formatUsd(order.amount)} estimate</div>
              </div>

              <section>
                <h3 className="mb-3 text-[12px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
                  Timeline
                </h3>
                <ol className="flex flex-col">
                  {timeline(detail.data).map((step, index, steps) => (
                    <li key={`${step.label}-${index}`} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span className={cn("mt-1 size-2.5 shrink-0 rounded-full", DOT[step.state])} />
                        {index < steps.length - 1 && <span className="my-1 w-px flex-1 bg-border" />}
                      </div>
                      <div className="pb-4">
                        <div className="text-[13.5px] font-semibold">{step.label}</div>
                        <div className="font-mono text-[12px] text-muted-foreground">{step.time ?? "—"}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>

              <dl className="flex flex-col divide-y divide-border rounded-xl border border-border">
                {(
                  [
                    { label: "Telegram user", value: buyer },
                    {
                      label: "telegram_payment_charge_id",
                      value: order.telegram_payment_charge_id ?? "—",
                      copy: Boolean(order.telegram_payment_charge_id),
                    },
                    { label: "Currency", value: "XTR" },
                    { label: "Reference", value: order.reference ?? "—" },
                    { label: "Expires", value: formatWhen(order.expires_at) },
                    ...(order.invoice_link ? [{ label: "Invoice link", value: order.invoice_link, copy: true }] : []),
                  ] satisfies { label: string; value: string; copy?: boolean }[]
                ).map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-4 px-4 py-2.5">
                    <dt className="font-mono text-[12px] text-muted-foreground">{row.label}</dt>
                    <dd className="flex min-w-0 items-center gap-1 text-right text-[13px] font-medium">
                      <span className="truncate">{row.value}</span>
                      {"copy" in row && row.copy && <CopyButton value={row.value} label="" />}
                    </dd>
                  </div>
                ))}
              </dl>

              <section>
                <h3 className="mb-2 text-[12px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
                  {detail.data.raw_payment ? "Raw payment (from Telegram)" : "Order object"}
                </h3>
                <pre className="overflow-x-auto rounded-xl bg-[#0B1B2B] p-4 font-mono text-[12px] leading-relaxed text-[#CFE0FF]">
                  {JSON.stringify(detail.data.raw_payment ?? order, null, 2)}
                </pre>
              </section>

              {order.status === "paid" &&
                (confirmRefund ? (
                  <div className="rounded-xl border border-[#FDA29B] bg-[#FEF3F2] p-4 dark:border-[#7a2a24] dark:bg-[#2a1215]">
                    <div className="text-[14px] font-bold">
                      Refund {formatStars(order.amount)} Stars to {order.customer?.username ? `@${order.customer.username}` : "the buyer"}?
                    </div>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                      Telegram returns the Stars to the buyer immediately and deducts them from your bot balance.
                      This can't be undone.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Button
                        variant="danger"
                        className="border-transparent bg-[#D92D20] text-white hover:bg-[#B42318] dark:bg-[#D92D20] dark:text-white"
                        loading={refund.isPending}
                        onClick={() => refund.mutate({ id: order.id })}
                      >
                        Yes, refund
                      </Button>
                      <Button variant="secondary" onClick={() => setConfirmRefund(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="danger" className="w-full" onClick={() => setConfirmRefund(true)}>
                    Refund <Star className="text-inherit" /> {formatStars(order.amount)}
                  </Button>
                ))}

              {(order.status === "created" || order.status === "pre_checkout") && (
                <Button
                  variant="secondary"
                  className="w-full"
                  loading={cancel.isPending}
                  onClick={() => cancel.mutate({ id: order.id })}
                >
                  Cancel order
                </Button>
              )}
            </div>
          )
        )}
      </div>
    </>
  );
}
