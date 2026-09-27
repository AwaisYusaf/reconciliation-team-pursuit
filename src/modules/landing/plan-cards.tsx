/**
 * The two pricing cards, shared by the landing page and the in-app plan chooser (`/r/plan`), so
 * the plan a customer pays for looks and reads the same as the one they picked on the landing
 * page. Presentational only: no hooks, so it renders in a server or a client component. Each
 * caller supplies the buttons (`actions`): landing links to sign-up and a demo, the chooser
 * starts Checkout.
 */
import type { ReactNode } from "react";

import { GRADIENT_TEXT } from "@/src/components/ui/surfaces";
import type { PRICES_CENTS } from "@/src/modules/billing/pricing";
import type { Interval, PlanId } from "@/src/modules/billing/rules";
import { planPriceLabel, yearlySavingCents } from "@/src/modules/landing/plan-links";

export const PLAN_CARD_IDS: readonly PlanId[] = ["reconciliation", "reconciliation_ai"];

/** The cards' two button looks, for a caller's own `<a>` or `<button>`. */
export const PLAN_BUTTON_LIGHT =
  "glass-btn glass-btn-light w-full py-3.5 rounded-xl text-center text-xs sm:text-sm font-semibold";
export const PLAN_BUTTON_PRIMARY =
  "glass-btn glass-btn-primary inline-flex w-full items-center justify-center gap-2 py-3.5 rounded-xl text-center text-xs sm:text-sm font-semibold";
export const PLAN_BUTTON_PRIMARY_STYLE = {
  background: "linear-gradient(135deg, var(--color-hero-from) 0%, var(--color-hero-to) 100%)",
} as const;

/** The arrow the primary button carries. */
export function PlanButtonArrow() {
  return (
    <span className="glass-btn-arrow">
      <svg className="w-3.5 h-3.5 -rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3"></path>
      </svg>
    </span>
  );
}

function Feature({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return (
    <li className={strong ? "flex items-center gap-2.5 font-semibold text-primary" : "flex items-center gap-2.5"}>
      <svg className="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
        <path
          clipRule="evenodd"
          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
          fillRule="evenodd"
        ></path>
      </svg>
      {children}
    </li>
  );
}

function Price({ prices, interval, gradient }: { prices: { month: number; year: number }; interval: Interval; gradient: boolean }) {
  const saving = yearlySavingCents(prices);
  return (
    <>
      <div className="flex items-baseline gap-2">
        <span
          className={
            gradient
              ? `text-4xl sm:text-5xl font-semibold font-lp-serif ${GRADIENT_TEXT}`
              : "text-4xl sm:text-5xl font-semibold text-on-surface font-lp-serif"
          }
        >
          {planPriceLabel(prices[interval])}
        </span>
        <span className="text-sm font-medium text-on-surface-variant">{interval === "month" ? "/ month" : "/ year"}</span>
      </div>
      {interval === "year" && saving !== null && (
        <span className="text-xs text-secondary font-semibold mt-1 block">Save {planPriceLabel(saving)} a year</span>
      )}
    </>
  );
}

/** The card of the plan the org is on: a solid accent border and a warm tint, and no hover lift. */
const CURRENT_CARD =
  "border-2 border-primary shadow-warm-glow ring-4 ring-primary/10 bg-[linear-gradient(160deg,var(--color-surface)_0%,color-mix(in_srgb,var(--color-plus-light)_12%,var(--color-surface))_100%)]";

function CurrentRibbon() {
  return (
    <div className="absolute top-4 left-6 z-[2] inline-flex items-center gap-1.5 px-3.5 py-0.5 rounded-full bg-primary text-white font-semibold text-[11px] uppercase tracking-wider shadow-sm">
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
        <path clipRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" fillRule="evenodd"></path>
      </svg>
      Current plan
    </div>
  );
}

/** The current card's marker in place of a button: filled, not clickable. */
export function CurrentPlanMarker({ label }: { label: string }) {
  return (
    <div className="w-full min-h-11 py-3 rounded-xl text-center text-xs sm:text-sm font-semibold text-primary bg-primary/10 border border-primary/30">
      {label}
    </div>
  );
}

export function PlanCards({
  prices,
  interval,
  plans = PLAN_CARD_IDS,
  actions,
  current = null,
}: {
  prices: typeof PRICES_CENTS;
  interval: Interval;
  /** Which cards to show, in order; the chooser shows only the plan picked on the landing page. */
  plans?: readonly PlanId[];
  actions: (plan: PlanId) => ReactNode;
  /** The plan the org is on, marked with a ribbon and a stronger border (Plan & billing). */
  current?: PlanId | null;
}) {
  const one = plans.length === 1;
  return (
    <div className={one ? "grid grid-cols-1 gap-8 max-w-md" : "grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto"}>
      {plans.includes("reconciliation") && (
        <div
          className={
            current === "reconciliation"
              ? `relative rounded-3xl p-8 pt-12 flex flex-col justify-between ${CURRENT_CARD}`
              : "glass-tile bg-lp-surface-container-lowest/60 backdrop-blur-xl rounded-3xl p-8 border-2 border-primary/45 shadow-warm-card hover:shadow-warm-card-hover flex flex-col justify-between ring-1 ring-inset ring-white/30"
          }
        >
          {current === "reconciliation" && <CurrentRibbon />}
          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-2xl font-semibold text-on-surface font-lp-serif">Reconciliation</h3>
              <span className="text-xs font-semibold px-3 py-1 rounded-full bg-lp-surface-container text-on-surface-variant border border-outline-variant/40">
                Single Contract
              </span>
            </div>
            <div className="mb-6">
              <Price prices={prices.reconciliation} interval={interval} gradient={false} />
              <span className="text-xs text-on-surface-variant font-medium mt-1 block">Full core ledger &amp; packet generation</span>
            </div>
            <p className="text-xs text-on-surface-variant mb-6 leading-relaxed">
              Designed for organizations managing one dedicated municipal or state grant contract seeking to replace manual spreadsheets.
            </p>
            <ul className="space-y-3 text-xs text-on-surface mb-8">
              <Feature>Complete 9-item transaction capture &amp; validation</Feature>
              <Feature>Hard documentation gate (blocks missing proof)</Feature>
              <Feature>Word cover sheet &amp; Excel sub-ledger generator</Feature>
              <Feature>Automated merged &lt;25MB filing PDF compiler</Feature>
              <Feature>Live category budget depletion alerts</Feature>
              <Feature>Standard email onboarding &amp; support</Feature>
            </ul>
          </div>
          <div className="flex flex-col gap-3">{actions("reconciliation")}</div>
        </div>
      )}

      {plans.includes("reconciliation_ai") && (
        <div
          className={
            current === "reconciliation_ai"
              ? `relative rounded-3xl p-8 pt-12 flex flex-col justify-between ${CURRENT_CARD}`
              : "glass-tile relative bg-lp-surface-container-lowest/60 backdrop-blur-xl rounded-3xl p-8 pt-12 border-2 border-primary/70 shadow-warm-glow flex flex-col justify-between ring-1 ring-inset ring-white/20"
          }
        >
          {current === "reconciliation_ai" && <CurrentRibbon />}
          {current !== "reconciliation_ai" && (
            <div className="absolute top-4 right-6 z-[2] px-3.5 py-0.5 rounded-full bg-[linear-gradient(135deg,var(--color-hero-from)_0%,var(--color-hero-to)_100%)] text-white font-semibold text-[11px] uppercase tracking-wider shadow-sm">
              Recommended for Busy Directors
            </div>
          )}
          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-2xl font-semibold text-on-surface font-lp-serif">Reconciliation + AI</h3>
              <span className="text-xs font-semibold px-3 py-1 rounded-full bg-brand-100 text-brand-900 border border-brand-200">
                All Features + AI
              </span>
            </div>
            <div className="mb-6">
              <Price prices={prices.reconciliation_ai} interval={interval} gradient />
              <span className="text-xs text-primary font-semibold mt-1 block">Full suite plus AI summaries and receipt reading</span>
            </div>
            <p className="text-xs text-on-surface-variant mb-6 leading-relaxed">
              For teams managing more than one funding source who want AI to draft the monthly summary and read the amounts off every receipt.
            </p>
            <ul className="space-y-3 text-xs text-on-surface mb-8">
              <Feature strong>Everything in Reconciliation Package</Feature>
              <Feature>Multiple funding sources, each with its own budget and packet</Feature>
              <Feature>AI monthly funding &amp; program summary, drafted for you to edit, in Word or PDF</Feature>
              <Feature>AI reads subtotal, tax &amp; fees from receipts and checks proof of payment</Feature>
              <Feature>Extract from invoice: one multi-line invoice becomes a draft expense per line</Feature>
            </ul>
          </div>
          <div className="flex flex-col gap-3">{actions("reconciliation_ai")}</div>
        </div>
      )}
    </div>
  );
}
