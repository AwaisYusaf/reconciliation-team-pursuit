"use client";

import { useId, useTransition } from "react";

import { reportResult } from "@/src/components/ui/toast";
import { cn } from "@/src/lib/cn";
import { UI } from "@/src/domain/strings";
import { startCheckoutAction } from "@/src/modules/billing/actions";
import type { Interval, PlanId } from "@/src/modules/billing/rules";
import {
  PLAN_BUTTON_LIGHT,
  PLAN_BUTTON_PRIMARY,
  PLAN_BUTTON_PRIMARY_STYLE,
  PlanButtonArrow,
} from "@/src/modules/landing/plan-cards";

/**
 * Sends the admin to Stripe Checkout for this plan and interval (Phase 16 §4.7). The action
 * checks everything on the server (admin, one open Checkout, funding-source limit) and returns
 * only a URL it has already verified is Stripe's; a refusal shows as the usual error toast.
 * While it works the label says so, per the no-spinner rule. Styled like the pricing card's own
 * button, since it sits inside the same card as on the landing page. `disabledReason`: the plan
 * can't be chosen right now (Reconciliation with more than one active source); the button is
 * disabled and the reason sits under it, rather than an error after the click.
 */
export function SubscribeButton({
  plan,
  interval,
  primary = false,
  disabledReason,
}: {
  plan: PlanId;
  interval: Interval;
  primary?: boolean;
  disabledReason?: string;
}) {
  const [pending, startTransition] = useTransition();
  const reasonId = useId();

  return (
    <>
      <button
        type="button"
        className={cn(
          primary ? PLAN_BUTTON_PRIMARY : PLAN_BUTTON_LIGHT,
          "min-h-11 disabled:opacity-60",
          disabledReason ? "disabled:cursor-not-allowed" : "disabled:cursor-wait",
        )}
        style={primary ? PLAN_BUTTON_PRIMARY_STYLE : undefined}
        disabled={pending || disabledReason !== undefined}
        aria-describedby={disabledReason ? reasonId : undefined}
        onClick={() =>
          startTransition(async () => {
            const result = await startCheckoutAction(plan, interval);
            if (reportResult(result)) window.location.assign(result.data.url);
          })
        }
      >
        <span>{pending ? UI.billingOpeningCheckout : UI.billingSubscribe}</span>
        {primary && !pending && <PlanButtonArrow />}
      </button>
      {disabledReason && (
        <p id={reasonId} className="text-sm text-on-surface-variant leading-snug">
          {disabledReason}
        </p>
      )}
    </>
  );
}
