/**
 * Plan display and sign-up links for the landing page (Phase 7). Pure and client-safe — only
 * a type import from billing/rules, and a value import of `PRICES_CENTS` itself, which is a
 * plain `as const` object with no I/O (see its own doc comment).
 */
import type { Interval, PlanId } from "@/src/modules/billing/rules";
import { PRICES_CENTS } from "@/src/modules/billing/pricing";
import { splitMoney } from "@/src/domain/format";
import { UI } from "@/src/domain/strings";

/** A whole-dollar price prints without its trailing `.00`; anything else keeps its cents.
 *  Never rounds, so a mismatch with the actual cents figure fails loudly rather than printing
 *  a wrong price. */
export function planPriceLabel(cents: number): string {
  const { whole, fraction } = splitMoney(cents);
  return fraction === ".00" ? whole : `${whole}${fraction}`;
}

/** What a year plan saves against paying monthly for 12 months, or `null` when it doesn't
 *  (today's prices: yearly is exactly 12x monthly, so this is `null` until that changes). */
export function yearlySavingCents(prices: { month: number; year: number }): number | null {
  const saving = prices.month * 12 - prices.year;
  return saving > 0 ? saving : null;
}

export const DEMO_REQUEST_HREF = `mailto:${UI.supportEmail}?subject=Stay%20Funded%20360%20demo%20request`;

/**
 * Where a pricing card's "Get Started" button goes.
 *
 * Closed signup always lands on the walkthrough anchor, even for a specific plan and interval:
 * there is nowhere else to send someone who can't sign up yet. Open signup with no plan given
 * is a plain `/signup`. Open signup with a plan and interval only carries them through the URL
 * when both are real keys of `PRICES_CENTS` — a forged or stale pair falls back to plain
 * `/signup` rather than a link the signup page would have to re-validate anyway. Never carries
 * a return-to parameter.
 */
export function getStartedHref(signupOpen: boolean, plan?: string, interval?: string): string {
  // Sign-up closed: the way in is a demo, so Get Started opens the same email as Book a demo.
  if (!signupOpen) return DEMO_REQUEST_HREF;
  if (!plan) return "/signup";
  if (
    !Object.hasOwn(PRICES_CENTS, plan) ||
    !Object.hasOwn(PRICES_CENTS[plan as PlanId], interval as Interval)
  ) {
    return "/signup";
  }
  return `/signup?${new URLSearchParams({ plan, interval: interval! })}`;
}
