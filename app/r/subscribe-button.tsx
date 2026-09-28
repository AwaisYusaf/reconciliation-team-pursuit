"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Dialog } from "@/src/components/ui/dialog";
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
 * button, since it sits inside the same card as on the landing page.
 *
 * `keepOneOf`: the org's active funding sources, when choosing this plan (Reconciliation) means
 * keeping only one (C8). The question is asked only then, after the click, rather than a list on
 * the page before anyone has chosen a plan: which one to keep, then Checkout opens. Nothing is
 * archived here: the choice goes to Checkout, and the others are archived once the payment goes
 * through (D-129), so backing out of Checkout changes nothing.
 */
export function SubscribeButton({
  plan,
  interval,
  primary = false,
  keepOneOf,
}: {
  plan: PlanId;
  interval: Interval;
  primary?: boolean;
  keepOneOf?: ReadonlyArray<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState(false);
  const [keepId, setKeepId] = useState<string | null>(null);
  const legendId = useId();
  const mustChoose = keepOneOf !== undefined && keepOneOf.length > 1;

  /** Opens Checkout; `keep` is the source chosen in the dialog, when there was one to choose. */
  function checkout(keep: string | null = null) {
    startTransition(async () => {
      const result = await startCheckoutAction({ plan, interval, keepFundingSourceId: keep });
      if (reportResult(result)) {
        window.location.assign(result.data.url);
      } else {
        // Refused (the sources changed since the page loaded, say): close the question and show
        // the sources as they are now, so the next click asks about the right ones.
        setAsking(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        className={cn(primary ? PLAN_BUTTON_PRIMARY : PLAN_BUTTON_LIGHT, "min-h-11 disabled:opacity-60 disabled:cursor-wait")}
        style={primary ? PLAN_BUTTON_PRIMARY_STYLE : undefined}
        disabled={pending}
        onClick={() => (mustChoose ? setAsking(true) : checkout())}
      >
        <span>{pending && !asking ? UI.billingOpeningCheckout : UI.billingSubscribe}</span>
        {primary && !pending && <PlanButtonArrow />}
      </button>

      {mustChoose && (
        <Dialog
          open={asking}
          tone="neutral"
          title={UI.billingKeepWhichTitle}
          dismissLabel={UI.billingGoBack}
          dismissDisabled={pending}
          onDismiss={() => setAsking(false)}
          confirm={{
            label: pending ? UI.billingOpeningCheckout : UI.billingKeepAndContinue,
            disabled: pending || keepId === null,
            onConfirm: () => keepId && checkout(keepId),
          }}
        >
          <p className="mb-4">{UI.billingKeepWhichBody}</p>
          <fieldset aria-labelledby={legendId} className="flex flex-col gap-2">
            <legend id={legendId} className="sr-only">
              {UI.billingKeepWhichLegend}
            </legend>
            {keepOneOf!.map((source) => (
              <label
                key={source.id}
                className={cn(
                  "flex items-center gap-3 min-h-11 px-3.5 py-2 rounded-[10px] border cursor-pointer text-ink",
                  keepId === source.id ? "border-accent bg-section" : "border-line bg-surface hover:bg-section",
                )}
              >
                <input
                  type="radio"
                  name={`keep-${plan}-${interval}`}
                  value={source.id}
                  checked={keepId === source.id}
                  disabled={pending}
                  onChange={() => setKeepId(source.id)}
                  className="w-4 h-4 accent-[var(--color-accent)]"
                />
                <span className="font-medium">{source.name}</span>
              </label>
            ))}
          </fieldset>
        </Dialog>
      )}
    </>
  );
}
