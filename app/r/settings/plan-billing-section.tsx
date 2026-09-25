"use client";

/**
 * Settings → Plan & billing (Phase 15 §4.3). Every state comes from `planBillingView` (pure,
 * unit-tested); this component only renders it and calls the billing actions, which re-check
 * everything on the server (admin, Stripe's live state, the funding-source limit).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button, buttonClassName } from "@/src/components/ui/button";
import { Dialog } from "@/src/components/ui/dialog";
import { Helper } from "@/src/components/ui/field";
import { PlusBadge } from "@/src/components/ui/plus-badge";
import { Card, CARD_PADDING, DangerPanel, SectionTitle } from "@/src/components/ui/surfaces";
import { reportResult, toast } from "@/src/components/ui/toast";
import { formatDateTimeUS, formatDateUS, todayIso, type IsoDate } from "@/src/domain/dates";
import { formatMoney } from "@/src/domain/format";
import { PLAN_LABELS, UI } from "@/src/domain/strings";
import type { ActionResult } from "@/src/lib/action-result";
import { cn } from "@/src/lib/cn";
import {
  applyChangeAction,
  billingPortalAction,
  cancelPendingChangeAction,
  cancelPlanAction,
  endPlanNowAction,
  quoteChangeAction,
  resumePlanAction,
} from "@/src/modules/billing/actions";
import type { ChangeQuote } from "@/src/modules/billing/billing";
import type { PlanBillingData } from "@/src/modules/billing/plan-view-loader";
import { intervalAdverb, intervalNoun } from "@/src/modules/billing/plan-view";
import { priceCents } from "@/src/modules/billing/pricing";
import { INTERVALS, type Interval, type PlanId } from "@/src/modules/billing/rules";

const PLAN_IDS: readonly PlanId[] = ["reconciliation", "reconciliation_ai"];

const dayOf = (iso: IsoDate | null) => (iso ? formatDateUS(iso) : "");
/** A Stripe timestamp as the calendar day in the org's time zone (`todayIso` pins America/Detroit). */
const dayOfMs = (ms: number) => formatDateUS(todayIso(new Date(ms)));

export function PlanBillingSection({ data }: { data: PlanBillingData }) {
  const { view, isAdmin, adminNames, activeSources } = data;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [choosing, setChoosing] = useState(false);
  const [chooseInterval, setChooseInterval] = useState<Interval>(
    view.kind === "subscribed" && view.interval ? view.interval : "month",
  );
  const [quote, setQuote] = useState<ChangeQuote | null>(null);
  const [confirm, setConfirm] = useState<"cancel" | "endNow" | null>(null);

  /** Runs a billing action; on success toasts and re-renders from the server. */
  function act(work: () => Promise<ActionResult<unknown>>, success: string, after?: () => void) {
    startTransition(async () => {
      if (reportResult(await work(), success)) {
        after?.();
        router.refresh();
      }
    });
  }

  /** Card and invoices: Stripe's hosted page, never ours. */
  function openPortal() {
    startTransition(async () => {
      const result = await billingPortalAction();
      if (reportResult(result)) window.location.assign(result.data.url);
    });
  }

  function pickPlan(plan: PlanId, interval: Interval) {
    startTransition(async () => {
      const result = await quoteChangeAction(plan, interval);
      if (reportResult(result)) setQuote(result.data);
    });
  }

  function applyQuote(q: ChangeQuote) {
    startTransition(async () => {
      const result = await applyChangeAction(q.to.plan, q.to.interval, q.prorationDate);
      if (!reportResult(result)) return;
      if (result.data.result === "payment_needed") {
        // Declined or needs 3-D Secure: the old plan stays; Stripe's page takes the payment.
        if (result.data.payUrl) window.location.assign(result.data.payUrl);
        else toast.error(UI.billingPaymentPending);
        return;
      }
      toast.success(result.data.result === "scheduled" ? UI.billingScheduledToast : UI.billingChangedToast);
      setQuote(null);
      setChoosing(false);
      router.refresh();
    });
  }

  const portalButton = (
    <div>
      <Button variant="secondary" disabled={pending} onClick={openPortal}>
        {pending ? UI.billingOpeningPortal : UI.billingPortal}
      </Button>
      <Helper>{UI.billingPortalHelp}</Helper>
    </div>
  );

  return (
    <Card className={CARD_PADDING} data-tour="settings-plan">
      <SectionTitle gradient className="mb-5">
        {UI.billingSectionTitle}
      </SectionTitle>

      {view.kind === "off" && <p className="text-[15px] text-sub">{UI.billingNotEnabled}</p>}

      {view.kind === "none" && (
        <div className="space-y-3">
          <p className="text-[15px] text-ink">{UI.billingNoPlan}</p>
          {isAdmin ? (
            <Link href="/r/plan" className={buttonClassName("primary")}>
              {UI.billingSeePlans}
            </Link>
          ) : (
            <Helper>{UI.billingManagerNote}</Helper>
          )}
        </div>
      )}

      {view.kind === "complimentaryAccess" && (
        <div className="space-y-3">
          <p className="text-[15px] text-ink">
            {view.until
              ? UI.billingComplimentaryUntil(PLAN_LABELS[view.plan], formatDateUS(view.until))
              : UI.billingComplimentary(PLAN_LABELS[view.plan])}
          </p>
          {view.endingSoon && view.until && isAdmin && (
            <DangerPanel tone="notice">{UI.billingCompEnding(formatDateUS(view.until))}</DangerPanel>
          )}
          <Helper>{UI.billingQuestions}</Helper>
        </div>
      )}

      {view.kind === "subscribed" && (
        <div className="space-y-5">
          {view.paymentFailed && (
            <DangerPanel tone="blocking">
              {isAdmin ? UI.billingPaymentFailed : UI.billingPaymentFailedManager(adminNames)}
            </DangerPanel>
          )}

          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="font-serif text-lg sm:text-xl font-bold text-ink">{PLAN_LABELS[view.plan]}</span>
              {view.plan === "reconciliation_ai" && <PlusBadge size="sm" />}
            </div>
            {view.interval && (
              <p className="text-[15px] text-sub mt-1">
                {view.interval === "month" ? UI.billingBilledMonthly : UI.billingBilledYearly}
              </p>
            )}
            {view.periodEnd && !view.paymentFailed && (
              <p className="text-[15px] text-ink mt-1">
                {view.cancelling ? UI.billingCancelling(dayOf(view.periodEnd)) : UI.billingRenews(dayOf(view.periodEnd))}
              </p>
            )}
          </div>

          {view.pending && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[15px] text-ink">
                {view.pending.kind === "downgrade"
                  ? UI.billingDowngradeQueued(
                      formatDateUS(view.pending.at),
                      PLAN_LABELS[view.pending.plan],
                      intervalAdverb(view.pending.interval),
                    )
                  : UI.billingPriceMoveQueued(formatDateUS(view.pending.at))}
              </p>
              {view.pending.kind === "downgrade" && isAdmin && (
                <Button
                  variant="quiet"
                  disabled={pending}
                  onClick={() => act(() => cancelPendingChangeAction(), UI.billingChangeDroppedToast)}
                >
                  {UI.billingCancelChange}
                </Button>
              )}
            </div>
          )}

          {view.upgrade && (
            <div className="border border-line rounded-[3px] bg-section p-4 space-y-3">
              <p className="text-[15px] text-ink">
                {UI.billingUpgradeWaiting(formatDateTimeUS(new Date(view.upgrade.expiresAt)))}
              </p>
              {isAdmin && (
                <a href={view.upgrade.payUrl} className={buttonClassName("primary")}>
                  {UI.billingPayNow}
                </a>
              )}
            </div>
          )}

          {!isAdmin && <Helper>{UI.billingManagerNote}</Helper>}

          {isAdmin && (
            <div className="flex flex-wrap items-start gap-3">
              {view.paymentFailed ? (
                <>
                  {portalButton}
                  <Button variant="quiet" disabled={pending} onClick={() => setConfirm("endNow")}>
                    {UI.billingEndNow}
                  </Button>
                </>
              ) : view.cancelling ? (
                <>
                  <Button
                    disabled={pending}
                    onClick={() => act(() => resumePlanAction(), UI.billingResumedToast)}
                  >
                    {UI.billingKeepPlan}
                  </Button>
                  {portalButton}
                </>
              ) : (
                <>
                  <Button disabled={pending} onClick={() => setChoosing((open) => !open)} aria-expanded={choosing}>
                    {UI.billingSwitchPlan}
                  </Button>
                  {portalButton}
                  <Button variant="quiet" disabled={pending} onClick={() => setConfirm("cancel")}>
                    {UI.billingCancelPlan}
                  </Button>
                </>
              )}
            </div>
          )}

          {choosing && isAdmin && !view.paymentFailed && !view.cancelling && (
            <SwitchPicker
              current={{ plan: view.plan, interval: view.interval }}
              interval={chooseInterval}
              onInterval={setChooseInterval}
              activeSources={activeSources}
              disabled={pending}
              onPick={pickPlan}
            />
          )}

          <Dialog
            open={quote !== null}
            tone="neutral"
            title={quote ? UI.billingSwitchTitle(PLAN_LABELS[quote.to.plan], intervalAdverb(quote.to.interval)) : ""}
            dismissLabel={UI.billingGoBack}
            dismissDisabled={pending}
            onDismiss={() => setQuote(null)}
            confirm={
              quote
                ? {
                    label: pending
                      ? UI.billingSwitching
                      : quote.change === "now"
                        ? quote.dueTodayCents > 0
                          ? UI.billingConfirmPay(formatMoney(quote.dueTodayCents))
                          : UI.billingSwitchNow
                        : UI.billingConfirmSchedule(dayOfMs(quote.effectiveAt)),
                    disabled: pending,
                    onConfirm: () => applyQuote(quote),
                  }
                : undefined
            }
          >
            {quote && <QuoteSummary quote={quote} />}
          </Dialog>

          <Dialog
            open={confirm === "cancel"}
            title={UI.billingCancelTitle}
            dismissLabel={UI.billingKeepPlan}
            dismissDisabled={pending}
            onDismiss={() => setConfirm(null)}
            confirm={{
              label: pending ? UI.billingCancellingNow : UI.billingCancelPlan,
              disabled: pending,
              onConfirm: () => act(() => cancelPlanAction(), UI.billingCancelledToast, () => setConfirm(null)),
            }}
          >
            {UI.billingCancelBody(dayOf(view.periodEnd))}
          </Dialog>

          <Dialog
            open={confirm === "endNow"}
            title={UI.billingEndNowTitle}
            dismissLabel={UI.billingKeepPlan}
            dismissDisabled={pending}
            onDismiss={() => setConfirm(null)}
            confirm={{
              label: pending ? UI.billingEndingNow : UI.billingEndNow,
              disabled: pending,
              onConfirm: () => act(() => endPlanNowAction(), UI.billingEndedToast, () => setConfirm(null)),
            }}
          >
            {UI.billingEndNowBody}
          </Dialog>
        </div>
      )}
    </Card>
  );
}

/** The two plans for the chosen interval, the current one marked. Picking one asks Stripe for a
 *  quote (nothing changes yet); the dialog then shows Stripe's own figures. */
function SwitchPicker({
  current,
  interval,
  onInterval,
  activeSources,
  disabled,
  onPick,
}: {
  current: { plan: PlanId; interval: Interval | null };
  interval: Interval;
  onInterval: (interval: Interval) => void;
  activeSources: number;
  disabled: boolean;
  onPick: (plan: PlanId, interval: Interval) => void;
}) {
  return (
    <div className="border-t border-line pt-5 space-y-4">
      <div className="flex gap-2" role="group" aria-label="Billing interval">
        {INTERVALS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onInterval(value)}
            aria-pressed={interval === value}
            className={cn(
              "min-h-11 px-4 inline-flex items-center rounded-[3px] text-[15px] font-bold border",
              interval === value ? "bg-accent text-surface border-accent" : "bg-surface text-accent border-accent hover:bg-section",
            )}
          >
            {value === "month" ? UI.billingIntervalMonthly : UI.billingIntervalYearly}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {PLAN_IDS.map((plan) => {
          const isCurrent = plan === current.plan && interval === current.interval;
          // Reconciliation includes one active funding source (C8, P24); the server refuses too.
          const tooManySources = plan === "reconciliation" && current.plan !== "reconciliation" && activeSources > 1;
          return (
            <div key={plan} className="border border-line rounded-[3px] p-4 bg-surface">
              <div className="font-bold text-ink text-[16px]">{PLAN_LABELS[plan]}</div>
              <p className="text-xl font-bold text-ink mt-1 mb-3">
                {formatMoney(priceCents(plan, interval))}
                {interval === "month" ? UI.billingPerMonth : UI.billingPerYear}
              </p>
              {isCurrent ? (
                <Button fullWidth variant="secondary" disabled>
                  {UI.billingYourPlan}
                </Button>
              ) : (
                <Button fullWidth disabled={disabled || tooManySources} onClick={() => onPick(plan, interval)}>
                  {UI.billingSwitchPlan}
                </Button>
              )}
              {tooManySources && (
                <Helper>
                  {UI.billingDowngradeTooManySources(activeSources)}{" "}
                  <Link href="/r/settings?section=fundingSources" className="text-accent underline">
                    {UI.billingGoToSources}
                  </Link>
                </Helper>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The dialog body: label/value pairs (fits 375px better than a table) and one sentence. */
function QuoteSummary({ quote }: { quote: ChangeQuote }) {
  const now = quote.change === "now";
  const rows: Array<[string, string]> = [
    [UI.billingRowCurrent, `${PLAN_LABELS[quote.from.plan]}, ${intervalAdverb(quote.from.interval)}`],
    [UI.billingRowNew, `${PLAN_LABELS[quote.to.plan]}, ${intervalAdverb(quote.to.interval)}`],
    [UI.billingRowChanges, now ? UI.billingChangesNow : dayOfMs(quote.effectiveAt)],
    [UI.billingRowToday, formatMoney(quote.dueTodayCents)],
    [
      UI.billingRowAfter,
      UI.billingAfterThat(formatMoney(quote.recurringCents), intervalNoun(quote.to.interval), dayOfMs(quote.nextChargeAt)),
    ],
  ];
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-sub">{label}</dt>
            <dd className="text-ink font-bold">{value}</dd>
          </div>
        ))}
      </dl>
      <p>
        {now
          ? UI.billingUpgradeExplain(PLAN_LABELS[quote.to.plan], dayOfMs(quote.nextChargeAt))
          : UI.billingDowngradeExplain(PLAN_LABELS[quote.from.plan])}
      </p>
    </div>
  );
}
