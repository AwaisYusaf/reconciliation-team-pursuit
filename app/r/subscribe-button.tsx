"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Dialog } from "@/src/components/ui/dialog";
import { reportResult } from "@/src/components/ui/toast";
import { cn } from "@/src/lib/cn";
import { UI } from "@/src/domain/strings";
import { startCheckoutAction } from "@/src/modules/billing/actions";
import type { Interval, PlanId } from "@/src/modules/billing/rules";
import { archiveFundingSourceAction } from "@/src/modules/funding-sources/actions";
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
 * keeping only one (C8, D2). The question is asked only then, after the click, rather than a list
 * on the page before anyone has chosen a plan: which one to keep, then the others are archived
 * and Checkout opens. `disabledReason`: the plan can't be chosen here at all (Settings, where the
 * sources are archived in their own section); the button is disabled with the reason under it.
 */
export function SubscribeButton({
  plan,
  interval,
  primary = false,
  disabledReason,
  keepOneOf,
}: {
  plan: PlanId;
  interval: Interval;
  primary?: boolean;
  disabledReason?: string;
  keepOneOf?: ReadonlyArray<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState(false);
  const [keepId, setKeepId] = useState<string | null>(null);
  const reasonId = useId();
  const legendId = useId();
  const mustChoose = keepOneOf !== undefined && keepOneOf.length > 1;

  function checkout() {
    startTransition(async () => {
      const result = await startCheckoutAction(plan, interval);
      if (reportResult(result)) window.location.assign(result.data.url);
    });
  }

  /** Archive every source but the chosen one, then open Checkout. Stops at the first refusal:
   *  the page then re-renders from the server, so it shows whatever was archived before it. */
  function keepAndCheckout(keep: string) {
    startTransition(async () => {
      for (const source of keepOneOf ?? []) {
        if (source.id === keep) continue;
        if (!reportResult(await archiveFundingSourceAction(source.id))) {
          setAsking(false);
          router.refresh();
          return;
        }
      }
      const result = await startCheckoutAction(plan, interval);
      if (reportResult(result)) {
        window.location.assign(result.data.url);
      } else {
        setAsking(false);
        router.refresh();
      }
    });
  }

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
        onClick={() => (mustChoose ? setAsking(true) : checkout())}
      >
        <span>{pending && !asking ? UI.billingOpeningCheckout : UI.billingSubscribe}</span>
        {primary && !pending && <PlanButtonArrow />}
      </button>
      {disabledReason && (
        <p id={reasonId} className="text-sm text-on-surface-variant leading-snug">
          {disabledReason}
        </p>
      )}

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
            onConfirm: () => keepId && keepAndCheckout(keepId),
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
