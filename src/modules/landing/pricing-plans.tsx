"use client";

/**
 * The landing page's pricing cards and their Monthly/Yearly toggle (Phase 7). The one island in
 * the pricing section: the toggle is state, the rest of the page renders on the server. The
 * cards are the shared `PlanCards`, so the in-app chooser shows the same plans the same way.
 */
import { useState } from "react";

import { PRICES_CENTS } from "@/src/modules/billing/pricing";
import type { Interval } from "@/src/modules/billing/rules";
import {
  PLAN_BUTTON_LIGHT,
  PLAN_BUTTON_PRIMARY,
  PLAN_BUTTON_PRIMARY_STYLE,
  PlanButtonArrow,
  PlanCards,
} from "@/src/modules/landing/plan-cards";
import { DEMO_REQUEST_HREF, getStartedHref } from "@/src/modules/landing/plan-links";

export function PricingPlans({ signupOpen }: { signupOpen: boolean }) {
  const [interval, setInterval] = useState<Interval>("month");

  return (
    <>
      {/* A pill group, keyboard-focusable, defaulting to Monthly. The card amounts and the
          Get Started links both read `interval`, so the two stay in step. */}
      <div className="flex justify-center mb-10 -mt-8">
        <div
          role="group"
          aria-label="Billing interval"
          className="inline-flex items-center gap-1 p-1 rounded-full bg-lp-surface-container-high border border-outline-variant"
        >
          {(["month", "year"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={interval === option}
              onClick={() => setInterval(option)}
              className={
                interval === option
                  ? "min-h-11 px-4 rounded-full text-sm font-semibold text-white glass-btn glass-btn-primary"
                  : "min-h-11 px-4 rounded-full text-sm font-semibold text-brand-800 hover:bg-lp-surface-container transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              }
            >
              {option === "month" ? "Monthly" : "Yearly"}
            </button>
          ))}
        </div>
      </div>

      <PlanCards
        prices={PRICES_CENTS}
        interval={interval}
        actions={(plan) =>
          plan === "reconciliation" ? (
            <>
              <a className={PLAN_BUTTON_LIGHT} href={getStartedHref(signupOpen, "reconciliation", interval)}>
                Get Started with Reconciliation
              </a>
              <a className={PLAN_BUTTON_LIGHT} href={DEMO_REQUEST_HREF}>
                Book a demo
              </a>
            </>
          ) : (
            <>
              <a
                className={PLAN_BUTTON_PRIMARY}
                href={getStartedHref(signupOpen, "reconciliation_ai", interval)}
                style={PLAN_BUTTON_PRIMARY_STYLE}
              >
                <span>Start with Reconciliation + AI</span>
                <PlanButtonArrow />
              </a>
              <a className={PLAN_BUTTON_LIGHT} href={DEMO_REQUEST_HREF}>
                Book a demo
              </a>
            </>
          )
        }
      />
    </>
  );
}
