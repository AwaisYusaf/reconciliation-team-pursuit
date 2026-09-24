import type { ReactNode } from "react";

import { GRADIENT_TEXT } from "@/src/components/ui/surfaces";
import { cn } from "@/src/lib/cn";
import { monthLabel, type MonthKey } from "@/src/domain/dates";
import { formatMoney, splitMoney } from "@/src/domain/format";
import type { MonthSpend } from "@/src/modules/dashboard/queries";

/**
 * The dashboard's headline card and its chart.
 *
 * A light card like every other one on the page, but with the ground shaded: white behind the
 * title and the figure, fading down into `hero-wash` behind the chart at the foot. The brown
 * is a wash rather than a fill precisely so the card keeps the page's ink/sub/accent text and
 * the accent bars unchanged — a fully dark card would mean a second colour scheme living
 * inside one component, and every value in it restated on dark.
 */
export function HeroCard({
  title,
  action,
  children,
  className,
}: {
  title: ReactNode;
  /** Top-right slot, for a scope label or a control. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "border border-line rounded-[12px] p-4 sm:p-5 flex flex-col",
        // Brown at the foot, white by the time it reaches the figure. The white stop lands at
        // 70% rather than 100% so the title and the money sit on flat white instead of on the
        // top of a ramp, which is what keeps the big figure one solid colour.
        "bg-[linear-gradient(to_top,var(--color-hero-wash)_0%,var(--color-surface)_70%)]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        {/* Same ramp as the figure below it, so the two lines read as one object. */}
        <h3 className={cn("font-serif text-base sm:text-lg font-bold m-0", GRADIENT_TEXT)}>
          {title}
        </h3>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * A money figure at hero size, with the cents set smaller than the dollars.
 *
 * `break-words` rather than a shrinking font: these figures are real grant totals and the
 * live data already runs to `$100,765,916.67`. Wrapping is predictable at any length, where
 * a fitted size is a guess that fails on the first number wider than the one it was tuned to.
 */
export function HeroMoney({ cents }: { cents: number }) {
  const { whole, fraction } = splitMoney(cents);
  // A negative hero figure is an overspend, and that is the one thing on this card that has to
  // be read as a problem rather than as a number. The gradient cannot say it: its ramp is the
  // page's own ink-to-accent browns, so an overspent total looked exactly like a healthy one
  // and "Total remaining" went negative in the same handsome brown it used when it was fine.
  //
  // Swapped rather than layered. `GRADIENT_TEXT` paints through `text-transparent` and
  // `bg-clip-text`, so a `text-danger` sitting beside it would colour nothing at all — the
  // gradient has to come off for the red to exist (the same rule `SectionTitle` follows when
  // it drops `text-ink`).
  const negative = cents < 0;
  return (
    // The cents come out lighter by where they fall in the ramp, which is why they no longer
    // carry a `text-sub` of their own.
    <div
      className={cn(
        "font-bold tabular-nums leading-none break-words",
        negative ? "text-danger" : GRADIENT_TEXT,
      )}
    >
      <span className="text-[28px] sm:text-[34px] lg:text-[38px]">{whole}</span>
      <span className="text-[17px] sm:text-xl">{fraction}</span>
    </div>
  );
}

/** A soft pill for a qualifier beside a card's title. */
export function HeroPill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-section px-3 py-1.5 text-[12px] font-bold text-sub",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Reimbursable spend across the twelve months of the active month's year.
 *
 * Bars, not a charting library: twelve values and no interaction is a flex row with heights,
 * and it stays a server component that way, so the screen ships no JavaScript for it.
 *
 * The active month's figure is also stated in the header, because that one has to be readable
 * without hovering anything — on a touch screen there is no hover at all.
 *
 * Every month's figure is available on hover. The tooltip is `group-hover` opacity, not state:
 * a hover readout that costs a client component and a hydration pass for twelve static numbers
 * is the tail wagging the dog. The end columns anchor their tooltip to their own edge instead
 * of centring it, which is what keeps January's and December's from hanging off the card.
 */
export function SpendChart({
  series,
  activeMonth,
}: {
  series: readonly MonthSpend[];
  activeMonth: MonthKey;
}) {
  // Floor of 1 keeps the division safe for a year with no spending at all, where every bar
  // is then correctly zero-height rather than NaN.
  const peak = Math.max(...series.map((entry) => entry.spentCents), 1);
  const active = series.find((entry) => entry.month === activeMonth);

  return (
    <div className="mt-auto pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-3">
        <span className="text-[11px] uppercase tracking-[0.06em] text-sub font-bold">
          Spent each month
        </span>
        {active && (
          <span className="text-[13px] tabular-nums text-sub">
            <span className="font-bold text-ink">{formatMoney(active.spentCents)}</span> in{" "}
            {monthLabel(active.month)}
          </span>
        )}
      </div>

      <div className="flex items-end gap-1 sm:gap-1.5 h-[92px] sm:h-[108px]">
        {series.map((entry, index) => {
          const isActive = entry.month === activeMonth;
          return (
            // The whole column is the hover target, not the 16px bar: a two-pixel January stub
            // is not something anyone can point at.
            <div
              key={entry.month}
              className="group relative flex-1 flex flex-col items-center justify-end h-full"
            >
              <div
                className={cn(
                  "pointer-events-none absolute bottom-full z-10 mb-1.5 whitespace-nowrap rounded-[6px]",
                  "bg-ink px-2 py-1 text-[11px] font-bold text-surface tabular-nums",
                  "opacity-0 transition-opacity group-hover:opacity-100",
                  // Centred in the middle of the axis, anchored to its own edge at the ends,
                  // where a centred tooltip would overhang the card.
                  index <= 1
                    ? "left-0"
                    : index >= series.length - 2
                      ? "right-0"
                      : "left-1/2 -translate-x-1/2",
                )}
              >
                {entry.label} {formatMoney(entry.spentCents)}
              </div>
              {/*
                A zero month still draws a 2px stub. A column of nothing is ambiguous between
                "no spending" and "no data"; a visible floor says the month was looked at.
              */}
              <div
                className={cn(
                  "w-full max-w-[16px] rounded-full transition-colors grow-up",
                  isActive ? "bg-accent" : "bg-accent/45 group-hover:bg-accent/70",
                )}
                style={{
                  height: `max(2px, ${(entry.spentCents / peak) * 100}%)`,
                  // A small stagger, so the year reads left to right rather than every bar
                  // arriving at once. 25ms apart puts the whole run under three quarters of a
                  // second, and the delay is on the animation only — the heights are already
                  // correct in the markup for anyone who never sees it play.
                  animationDelay: `${index * 25}ms`,
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="flex gap-1 sm:gap-1.5 mt-2" aria-hidden="true">
        {series.map((entry) => (
          <div
            key={entry.month}
            className={cn(
              "flex-1 text-center text-[11px]",
              entry.month === activeMonth ? "font-bold text-ink" : "text-sub",
            )}
          >
            {entry.label}
          </div>
        ))}
      </div>

      {/*
        The axis above is decorative duplication for sighted readers; this is the same twelve
        figures as a list, so a screen reader gets the series rather than a row of month
        abbreviations with no values attached.
      */}
      <ul className="sr-only">
        {series.map((entry) => (
          <li key={entry.month}>
            {monthLabel(entry.month)}: {formatMoney(entry.spentCents)}
            {entry.month === activeMonth ? ", the month being viewed" : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
