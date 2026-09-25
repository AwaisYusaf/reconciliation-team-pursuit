"use client";

import { useTransition } from "react";

import { Button } from "@/src/components/ui/button";
import { reportResult } from "@/src/components/ui/toast";
import { UI } from "@/src/domain/strings";
import { startCheckoutAction } from "@/src/modules/billing/actions";
import type { Interval, PlanId } from "@/src/modules/billing/rules";

/**
 * Sends the admin to Stripe Checkout for this plan and interval (Phase 15 §4.7). The action
 * checks everything on the server (admin, one open Checkout, funding-source limit) and returns
 * only a URL it has already verified is Stripe's; a refusal shows as the usual error toast.
 * While it works the label says so, per the no-spinner rule.
 */
export function SubscribeButton({ plan, interval }: { plan: PlanId; interval: Interval }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      fullWidth
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await startCheckoutAction(plan, interval);
          if (reportResult(result)) window.location.assign(result.data.url);
        })
      }
    >
      {pending ? UI.billingOpeningCheckout : UI.billingSubscribe}
    </Button>
  );
}
