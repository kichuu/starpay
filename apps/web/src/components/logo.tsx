import { cn } from "@starpay/ui/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="grid size-8 place-items-center rounded-full bg-brand shadow-[inset_0_0_0_3px_rgba(255,255,255,0.22),0_2px_6px_rgba(0,87,255,0.28)]">
        <span aria-hidden className="text-base leading-none text-star-bright">
          ★
        </span>
      </div>
      <div className="text-lg font-extrabold tracking-[-0.035em]">
        Star<span className="text-brand">pay</span>
      </div>
    </div>
  );
}
