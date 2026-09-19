import { cn } from "@starpay/ui/lib/utils";
import { useState } from "react";

import { formatCompact, formatStars } from "@/lib/format";

export type ChartBar = { key: string; label: string; tooltip: string; stars: number };

/**
 * Single-series column chart of Stars collected. One hue: the current period is
 * full brand blue, earlier ones a lighter step. Values are labelled only on the
 * latest and peak columns; every value is in the tooltip and the sr-only table.
 */
export function StarsChart({ bars, dimmed = false }: { bars: ChartBar[]; dimmed?: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...bars.map((bar) => bar.stars), 0);
  const peak = max > 0 ? bars.findIndex((bar) => bar.stars === max) : -1;
  const last = bars.length - 1;
  const labelEvery = bars.length > 12 ? Math.ceil(bars.length / 8) : 1;

  return (
    <div className={cn("transition-opacity", dimmed && "opacity-50")}>
      <div className="relative flex h-[170px] items-end gap-[2px]" aria-hidden>
        {/* Recessive baseline and peak reference line. */}
        <div className="absolute inset-x-0 bottom-6 h-px bg-border" />
        {bars.map((bar, index) => {
          const height = max > 0 ? Math.max((bar.stars / max) * 120, bar.stars > 0 ? 4 : 0) : 0;
          const showValue = bar.stars > 0 && (index === last || index === peak);
          return (
            <div
              key={bar.key}
              className="relative flex h-full flex-1 flex-col items-center justify-end"
              onPointerEnter={() => setActive(index)}
              onPointerLeave={() => setActive(null)}
            >
              {active === index && (
                <div className="pointer-events-none absolute bottom-[calc(100%-8px)] z-10 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-center whitespace-nowrap shadow-lg">
                  <div className="text-[13px] font-bold">★ {formatStars(bar.stars)}</div>
                  <div className="text-[11.5px] text-muted-foreground">{bar.tooltip}</div>
                </div>
              )}
              {showValue && (
                <div className="mb-1 font-mono text-[10.5px] text-muted-foreground">{formatCompact(bar.stars)}</div>
              )}
              <div
                className={cn(
                  "w-full max-w-6 rounded-t-[4px] transition-[filter]",
                  index === last ? "bg-brand" : "bg-[#A9C9FF] dark:bg-[#3a64b8]",
                  active === index && "brightness-110",
                )}
                style={{ height }}
              />
              <div className="mt-2 h-4 font-mono text-[11px] text-faint">
                {index % labelEvery === 0 || index === last ? bar.label : ""}
              </div>
            </div>
          );
        })}
      </div>
      <table className="sr-only">
        <caption>Stars collected per period</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">Stars</th>
          </tr>
        </thead>
        <tbody>
          {bars.map((bar) => (
            <tr key={bar.key}>
              <td>{bar.tooltip}</td>
              <td>{bar.stars}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
