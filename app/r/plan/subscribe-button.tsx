"use client";

import { useTransition } from "react";

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
 * Sends the admin to Stripe Checkout for this plan and interval (Phase 15 §4.7). The action
 * checks everything on the server (admin, one open Checkout, funding-source limit) and returns
 * only a URL it has already verified is Stripe's; a refusal shows as the usual error toast.
 * While it works the label says so, per the no-spinner rule. Styled like the pricing card's own
 * button, since it sits inside the same card as on the landing page.
 */
export function SubscribeButton({
  plan,
  interval,
  primary = false,
}: {
  plan: PlanId;
  interval: Interval;
  primary?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className={cn(primary ? PLAN_BUTTON_PRIMARY : PLAN_BUTTON_LIGHT, "min-h-11 disabled:opacity-60 disabled:cursor-wait")}
      style={primary ? PLAN_BUTTON_PRIMARY_STYLE : undefined}
      disabled={pending}
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
  );
}
