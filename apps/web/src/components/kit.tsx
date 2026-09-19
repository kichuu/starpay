// StarPay's UI kit, styled after the dashboard design. Built on Base UI where
// behaviour matters (dialogs, drawers, switches, menus) and plain Tailwind elsewhere.
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { cn } from "@starpay/ui/lib/utils";
import { Check, Copy, Loader2, X } from "lucide-react";
import { type ComponentProps, type ReactNode, useState } from "react";

// ── Buttons ──

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";

const buttonStyles: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white hover:bg-brand-strong dark:hover:bg-brand/85",
  secondary: "border border-input bg-card text-foreground hover:bg-muted",
  ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
  danger:
    "border border-[#FDA29B] bg-[#FEF3F2] text-[#B42318] hover:bg-[#FEE4E2] dark:border-[#7a2a24] dark:bg-[#2a1215] dark:text-[#f97066] dark:hover:bg-[#3a1719]",
  link: "px-0! text-brand hover:underline",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-[10px] font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        size === "md" ? "px-4 py-2 text-[13.5px]" : "px-3 py-1.5 text-[12.5px]",
        buttonStyles[variant],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" />}
      {children}
    </button>
  );
}

// ── Surfaces ──

export function Panel({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn("overflow-hidden rounded-2xl border border-border bg-card", className)}
      {...props}
    />
  );
}

export function PanelHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-4",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-[14.5px] font-bold">{title}</h2>
        {description && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Eyebrow({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "text-[12px] font-semibold tracking-[0.04em] text-muted-foreground uppercase",
        className,
      )}
      {...props}
    />
  );
}

export function Mono({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("font-mono text-[12.5px]", className)} {...props} />;
}

// ── Stars ──

export function Star({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("text-star", className)}>
      ★
    </span>
  );
}

export function StarAmount({ stars, className }: { stars: number; className?: string }) {
  return (
    <span className={cn("font-bold whitespace-nowrap", className)}>
      <Star /> {new Intl.NumberFormat("en-US").format(stars)}
      <span className="sr-only"> Stars</span>
    </span>
  );
}

// ── Status pills ──

type Tone = "neutral" | "warning" | "success" | "violet" | "muted" | "danger" | "brand";

const toneStyles: Record<Tone, string> = {
  neutral:
    "bg-[#F2F4F8] text-[#475467] border-[#E1E5EC] dark:bg-white/5 dark:text-[#b4bfd1] dark:border-white/10",
  warning:
    "bg-[#FFFAEB] text-[#B54708] border-[#FEDF89] dark:bg-[#3a2a06] dark:text-[#fdb022] dark:border-[#5c4508]",
  success:
    "bg-[#ECFDF3] text-[#067647] border-[#ABEFC6] dark:bg-[#0b2a1b] dark:text-[#47cd89] dark:border-[#135c37]",
  violet:
    "bg-[#F4F3FF] text-[#5925DC] border-[#D9D6FE] dark:bg-[#1f1845] dark:text-[#bdb4fe] dark:border-[#3e3190]",
  muted:
    "bg-[#F8F9FB] text-[#98A2B3] border-[#E4E7EC] dark:bg-white/[0.03] dark:text-[#6b7a93] dark:border-white/10",
  danger:
    "bg-[#FEF3F2] text-[#B42318] border-[#FDA29B] dark:bg-[#2a1215] dark:text-[#f97066] dark:border-[#7a2a24]",
  brand: "bg-brand-soft text-brand-strong border-brand-line",
};

export function Pill({ tone = "neutral", className, ...props }: ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full border px-2.5 py-0.5 text-[11.5px] font-bold whitespace-nowrap",
        toneStyles[tone],
        className,
      )}
      {...props}
    />
  );
}

const ORDER_STATUS: Record<string, { tone: Tone; label: string }> = {
  created: { tone: "neutral", label: "created" },
  pre_checkout: { tone: "warning", label: "pre-checkout" },
  paid: { tone: "success", label: "paid" },
  refunded: { tone: "violet", label: "refunded" },
  expired: { tone: "muted", label: "expired" },
  failed: { tone: "danger", label: "failed" },
  active: { tone: "success", label: "active" },
  cancelled: { tone: "warning", label: "cancelled" },
  archived: { tone: "muted", label: "archived" },
};

export function StatusPill({ status }: { status: string }) {
  const style = ORDER_STATUS[status] ?? { tone: "neutral" as const, label: status };
  return <Pill tone={style.tone}>{style.label}</Pill>;
}

// ── Segmented control (tabs, filters, Live/Test) ──

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  label,
}: {
  options: readonly { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "flex w-fit flex-wrap gap-1 rounded-xl border border-border bg-card p-1",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "cursor-pointer rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            value === option.value
              ? "bg-brand text-white"
              : "text-[#475467] hover:bg-muted dark:text-muted-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ── Form fields ──

export const inputClass =
  "w-full rounded-[10px] border border-input bg-card px-3.5 py-2.5 text-[13.5px] outline-none transition-colors placeholder:text-faint focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:opacity-60 aria-invalid:border-destructive";

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-semibold">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[12px] text-destructive">{error}</p>
      ) : (
        hint && <p className="text-[12px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

// ── Switch ──

export function Toggle({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <BaseSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="flex h-6 w-[42px] shrink-0 cursor-pointer items-center rounded-full bg-[#D7DDE7] p-[3px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 data-[checked]:bg-brand dark:bg-[#2a3a57]"
    >
      <BaseSwitch.Thumb className="size-[18px] rounded-full bg-white shadow-sm transition-transform data-[checked]:translate-x-[18px]" />
    </BaseSwitch.Root>
  );
}

// ── Dialog & drawer ──

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-[#0B1B2B]/40 transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <BaseDialog.Popup
          className={cn(
            "fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-2xl transition-all duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
            className,
          )}
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <BaseDialog.Title className="text-[17px] font-extrabold tracking-[-0.01em]">
                {title}
              </BaseDialog.Title>
              {description && (
                <BaseDialog.Description className="mt-1 text-[13px] text-muted-foreground">
                  {description}
                </BaseDialog.Description>
              )}
            </div>
            <BaseDialog.Close
              aria-label="Close"
              className="-mt-1 -mr-1 cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
            >
              <X className="size-4" />
            </BaseDialog.Close>
          </div>
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export function Drawer({
  open,
  onOpenChange,
  title,
  children,
  side = "right",
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  side?: "right" | "left";
  className?: string;
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-[#0B1B2B]/35 transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <BaseDialog.Popup
          className={cn(
            "fixed inset-y-0 z-50 flex w-full flex-col bg-card shadow-2xl transition-transform duration-200 ease-out",
            side === "right"
              ? "right-0 max-w-[480px] border-l border-border data-[ending-style]:translate-x-full data-[starting-style]:translate-x-full"
              : "left-0 max-w-[280px] border-r border-border data-[ending-style]:-translate-x-full data-[starting-style]:-translate-x-full",
            className,
          )}
        >
          <BaseDialog.Title className="sr-only">{title}</BaseDialog.Title>
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export const DrawerClose = BaseDialog.Close;

// ── Feedback states ──

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-6 py-14 text-center", className)}>
      {icon && (
        <div className="mb-1 grid size-11 place-items-center rounded-full bg-brand-soft text-brand [&_svg]:size-5">
          {icon}
        </div>
      )}
      <div className="text-[14.5px] font-bold">{title}</div>
      {children && (
        <div className="max-w-sm text-[13px] leading-relaxed text-muted-foreground">{children}</div>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <EmptyState
      title="Couldn't load this"
      action={
        onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )
      }
    >
      {error instanceof Error ? error.message : "Something went wrong."}
    </EmptyState>
  );
}

export function Shimmer({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

export function RowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 border-b border-border/60 px-5 py-4">
          <Shimmer className="h-3.5 w-24" />
          <Shimmer className="h-3.5 flex-1" />
          <Shimmer className="h-3.5 w-16" />
        </div>
      ))}
    </div>
  );
}

// ── Copy to clipboard ──

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : label}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-3.5"
    >
      {copied ? <Check className="text-[#067647]" /> : <Copy />}
      {copied ? "Copied" : label}
    </button>
  );
}

export function Avatar({ text, className }: { text: string; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "grid size-[30px] shrink-0 place-items-center rounded-full bg-brand-soft text-[12px] font-bold text-brand-strong",
        className,
      )}
    >
      {text}
    </div>
  );
}

/** Table rows are CSS grids so header and body share one column template. */
export function GridRow({
  columns,
  className,
  onClick,
  children,
  header = false,
}: {
  columns: string;
  className?: string;
  onClick?: () => void;
  children: ReactNode;
  header?: boolean;
}) {
  const interactive = Boolean(onClick);
  return (
    <div
      role="row"
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      style={{ gridTemplateColumns: columns }}
      className={cn(
        "grid items-center gap-3 border-b border-border/60 px-5",
        header
          ? "bg-subtle py-3 text-[11.5px] font-bold tracking-[0.04em] text-[#667085] uppercase dark:text-muted-foreground"
          : "py-3.5 text-[13.5px]",
        interactive &&
          "cursor-pointer outline-none hover:bg-row-hover focus-visible:bg-row-hover focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset",
        className,
      )}
    >
      {children}
    </div>
  );
}
