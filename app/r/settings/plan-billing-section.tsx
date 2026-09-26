"use client";

/**
 * Settings → Plan & billing (Phase 16 §4.3). Every state comes from `planBillingView` (pure,
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
import { Card, CARD_PADDING, DangerPanel, GRADIENT_TEXT, SectionTitle, SubsectionTitle } from "@/src/components/ui/surfaces";
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
import { PRICES_CENTS } from "@/src/modules/billing/pricing";
import { INTERVALS, type Interval, type PlanId } from "@/src/modules/billing/rules";
import {
  CurrentPlanMarker,
  PLAN_BUTTON_LIGHT,
  PLAN_BUTTON_PRIMARY,
  PLAN_BUTTON_PRIMARY_STYLE,
  PlanButtonArrow,
  PlanCards,
} from "@/src/modules/landing/plan-cards";

import { SubscribeButton } from "../plan/subscribe-button";

const dayOf = (iso: IsoDate | null) => (iso ? formatDateUS(iso) : "");
/** The summary's buttons, in the pricing cards' style (not full width, so they sit in one row). */
const PRIMARY =
  "glass-btn glass-btn-primary inline-flex items-center justify-center gap-2 min-h-11 px-5 rounded-xl text-sm font-semibold text-white disabled:opacity-60 disabled:cursor-wait";
const LIGHT =
  "glass-btn glass-btn-light inline-flex items-center justify-center gap-2 min-h-11 px-5 rounded-xl text-sm font-semibold disabled:opacity-60 disabled:cursor-wait";
const QUIET =
  "sm:ml-auto min-h-11 px-2 text-sm font-medium text-on-surface-variant underline underline-offset-2 hover:text-on-surface disabled:opacity-60";
const CHIP =
  "text-xs font-semibold px-3 py-1 rounded-full bg-lp-surface-container text-on-surface-variant border border-outline-variant/40";

/** A Stripe timestamp as the calendar day in the org's time zone (`todayIso` pins America/Detroit). */
const dayOfMs = (ms: number) => formatDateUS(todayIso(new Date(ms)));

export function PlanBillingSection({ data }: { data: PlanBillingData }) {
  const { view, isAdmin, adminNames, activeSources } = data;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [chooseInterval, setChooseInterval] = useState<Interval>(
    view.kind === "subscribed" && view.interval ? view.interval : "month",
  );
  const [quote, setQuote] = useState<ChangeQuote | null>(null);
  const [confirm, setConfirm] = useState<"cancel" | "endNow" | null>(null);
  // The section shows the org's own plan; the full cards open on request. With no plan there is
  // nothing else to show, so they start open.
  const [showPlans, setShowPlans] = useState(view.kind === "none");

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
      router.refresh();
    });
  }

  // Card and invoices leaves the app for Stripe; the tooltip and the screen-reader description
  // say so, rather than a helper line that pushed the other buttons out of line.
  const portalButton = (
    <button type="button" className={LIGHT} disabled={pending} onClick={openPortal} title={UI.billingPortalHelp} aria-describedby="portal-help">
      {pending ? UI.billingOpeningPortal : UI.billingPortal}
      <span id="portal-help" className="sr-only">
        {UI.billingPortalHelp}
      </span>
    </button>
  );

  // Why the admin can't switch right now, if they can't (the server refuses the same, §4.1).
  const switchBlocked =
    view.kind !== "subscribed"
      ? null
      : view.paymentFailed
        ? UI.billingPaymentFailedRefused
        : view.cancelling
          ? UI.billingCancelPending
          : view.upgrade
            ? UI.billingPaymentPending
            : view.pending
              ? UI.billingChangePending
              : null;

  // The card marked as the org's plan: the same plan and interval it pays for (the other interval
  // of the same plan is a real switch), or the complimentary plan.
  const currentPlan: PlanId | null =
    view.kind === "subscribed"
      ? chooseInterval === view.interval
        ? view.plan
        : null
      : view.kind === "complimentaryAccess"
        ? view.plan
        : null;

  /** Each plan card's buttons, by state. Nothing for a manager: they only see the plans. */
  function planActions(plan: PlanId) {
    if (plan === currentPlan) return <CurrentPlanMarker label={UI.billingYourPlan} />;
    if (!isAdmin) return null;
    // Complimentary: buy now, unless a plan was already bought during the free access.
    if (view.kind === "none" || (view.kind === "complimentaryAccess" && !view.upcoming)) {
      return (
        <SubscribeButton
          plan={plan}
          interval={chooseInterval}
          primary={plan === "reconciliation_ai"}
          // Reconciliation includes one active funding source (C8); the server refuses too.
          disabledReason={
            plan === "reconciliation" && activeSources > 1 ? UI.billingDowngradeTooManySources(activeSources) : undefined
          }
        />
      );
    }
    if (view.kind !== "subscribed" || switchBlocked) return null;

    // Reconciliation includes one active funding source (C8, P24); the server refuses too.
    const tooManySources = plan === "reconciliation" && view.plan !== "reconciliation" && activeSources > 1;
    const primary = plan === "reconciliation_ai";
    return (
      <>
        <button
          type="button"
          className={cn(primary ? PLAN_BUTTON_PRIMARY : PLAN_BUTTON_LIGHT, "min-h-11 disabled:opacity-60 disabled:cursor-not-allowed")}
          style={primary ? PLAN_BUTTON_PRIMARY_STYLE : undefined}
          disabled={pending || tooManySources}
          aria-describedby={tooManySources ? `too-many-${plan}` : undefined}
          onClick={() => pickPlan(plan, chooseInterval)}
        >
          <span>{UI.billingSwitchPlan}</span>
          {primary && <PlanButtonArrow />}
        </button>
        {tooManySources && (
          <p id={`too-many-${plan}`} className="text-xs text-on-surface-variant leading-relaxed">
            {UI.billingDowngradeTooManySources(activeSources)}{" "}
            <Link href="/r/settings?section=fundingSources" className="text-accent underline">
              {UI.billingGoToSources}
            </Link>
          </p>
        )}
      </>
    );
  }

  return (
    <Card className={CARD_PADDING} data-tour="settings-plan">
      <SectionTitle gradient className="mb-5">
        {UI.billingSectionTitle}
      </SectionTitle>

      {view.kind === "off" && <p className="text-[15px] text-sub">{UI.billingNotEnabled}</p>}

      {view.kind === "subscribed" && view.paymentFailed && (
        <DangerPanel tone="blocking" className="mb-5">
          {view.onHold
            ? isAdmin
              ? UI.billingOnHold
              : UI.billingOnHoldManager(adminNames)
            : isAdmin
              ? UI.billingPaymentFailed
              : UI.billingPaymentFailedManager(adminNames)}
        </DangerPanel>
      )}

      {/* The org's plan at a glance, in the pricing cards' look. The complimentary ending warning
          is the banner above the page, not repeated here. */}
      {view.kind !== "off" && (
        <div className="rounded-3xl border-2 border-primary/50 shadow-warm-card ring-1 ring-inset ring-white/30 p-5 sm:p-7 bg-[linear-gradient(135deg,var(--color-surface)_0%,color-mix(in_srgb,var(--color-plus-light)_14%,var(--color-surface))_60%,color-mix(in_srgb,var(--color-accent)_16%,var(--color-surface))_100%)]">
          <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-muted mb-2">{UI.billingYourPlan}</div>
          {view.kind === "none" ? (
            <p className="text-[15px] text-ink">{UI.billingNoPlan}</p>
          ) : (
            <>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h3 className={`text-2xl font-semibold font-lp-serif ${GRADIENT_TEXT}`}>{PLAN_LABELS[view.plan]}</h3>
                {view.plan === "reconciliation_ai" && <PlusBadge size="sm" />}
                {view.kind === "complimentaryAccess" && <span className={CHIP}>{UI.billingComplimentaryTag}</span>}
                {view.kind === "subscribed" && view.interval && (
                  <span className={CHIP}>{view.interval === "month" ? UI.billingIntervalMonthly : UI.billingIntervalYearly}</span>
                )}
              </div>
              <p className="text-sm text-on-surface-variant mt-1.5">
                {view.kind === "complimentaryAccess"
                  ? view.until
                    ? UI.billingComplimentaryUntil(PLAN_LABELS[view.plan], formatDateUS(view.until))
                    : UI.billingComplimentary(PLAN_LABELS[view.plan])
                  : view.periodEnd && !view.paymentFailed
                    ? view.cancelling
                      ? UI.billingCancelling(dayOf(view.periodEnd))
                      : UI.billingRenews(dayOf(view.periodEnd))
                    : view.interval === "year"
                      ? UI.billingBilledYearly
                      : UI.billingBilledMonthly}
              </p>
              {view.kind === "complimentaryAccess" && view.upcoming && (
                <p className="text-sm text-on-surface mt-2">
                  {view.upcoming.cancelling
                    ? UI.billingCompUpcomingCancelled
                    : UI.billingCompUpcoming(
                        PLAN_LABELS[view.upcoming.plan],
                        view.upcoming.interval ? intervalAdverb(view.upcoming.interval) : "",
                        dayOf(view.upcoming.startsOn),
                      )}
                </p>
              )}
            </>
          )}

          {/* One row of actions: the main one first, Card and invoices beside it, the
              destructive one last and quiet. */}
          {view.kind !== "none" && (
            <div className="flex flex-wrap items-center gap-3 mt-6 pt-5 border-t border-line/70">
              {view.kind === "subscribed" && isAdmin && view.paymentFailed && (
                <>
                  {portalButton}
                  <button type="button" className={QUIET} disabled={pending} onClick={() => setConfirm("endNow")}>
                    {UI.billingEndNow}
                  </button>
                </>
              )}
              {view.kind === "subscribed" && isAdmin && !view.paymentFailed && view.cancelling && (
                <>
                  <button
                    type="button"
                    className={PRIMARY}
                    style={PLAN_BUTTON_PRIMARY_STYLE}
                    disabled={pending}
                    onClick={() => act(() => resumePlanAction(), UI.billingResumedToast)}
                  >
                    {UI.billingKeepPlan}
                  </button>
                  {portalButton}
                </>
              )}
              {!(view.kind === "subscribed" && isAdmin && (view.paymentFailed || view.cancelling)) && (
                <button
                  type="button"
                  className={view.kind === "subscribed" && isAdmin ? PRIMARY : LIGHT}
                  style={view.kind === "subscribed" && isAdmin ? PLAN_BUTTON_PRIMARY_STYLE : undefined}
                  aria-expanded={showPlans}
                  aria-controls="plan-cards"
                  onClick={() => setShowPlans((open) => !open)}
                >
                  {showPlans ? UI.billingHidePlans : view.kind === "subscribed" && isAdmin ? UI.billingChangePlan : UI.billingSeePlans}
                </button>
              )}
              {isAdmin &&
                ((view.kind === "subscribed" && !view.paymentFailed && !view.cancelling) ||
                  (view.kind === "complimentaryAccess" && view.upcoming)) &&
                portalButton}
              {view.kind === "complimentaryAccess" && view.upcoming?.cancelling && isAdmin && (
                <button
                  type="button"
                  className={LIGHT}
                  disabled={pending}
                  onClick={() => act(() => resumePlanAction(), UI.billingResumedToast)}
                >
                  {UI.billingKeepPlan}
                </button>
              )}
              {isAdmin &&
                ((view.kind === "subscribed" && !view.paymentFailed && !view.cancelling) ||
                  (view.kind === "complimentaryAccess" && view.upcoming && !view.upcoming.cancelling)) && (
                  <button type="button" className={QUIET} disabled={pending} onClick={() => setConfirm("cancel")}>
                    {UI.billingCancelPlan}
                  </button>
                )}
            </div>
          )}
        </div>
      )}

      {view.kind === "subscribed" && (
        <div className="space-y-5">
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

      {/* The plans, as on the landing page: what the org is on, and what it can switch to. */}
      {view.kind !== "off" && showPlans && (
        <div id="plan-cards" className="mt-8 pt-6 border-t border-line">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <SubsectionTitle gradient>{UI.billingPlansTitle}</SubsectionTitle>
            <div
              role="group"
              aria-label="Billing interval"
              className="inline-flex items-center gap-1 p-1 rounded-full bg-lp-surface-container-high border border-outline-variant"
            >
              {INTERVALS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={chooseInterval === value}
                  onClick={() => setChooseInterval(value)}
                  className={
                    chooseInterval === value
                      ? "min-h-11 px-4 rounded-full text-sm font-semibold text-white glass-btn glass-btn-primary"
                      : "min-h-11 px-4 rounded-full text-sm font-semibold text-brand-800 hover:bg-lp-surface-container transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  }
                >
                  {value === "month" ? UI.billingIntervalMonthly : UI.billingIntervalYearly}
                </button>
              ))}
            </div>
          </div>
          {view.kind === "complimentaryAccess" && !view.upcoming && isAdmin && (
            <p className="text-[15px] text-sub mb-4">
              {view.buy.kind === "defer" ? UI.billingCompBuyDeferred(dayOf(view.buy.firstChargeOn)) : UI.billingCompBuyNow}
            </p>
          )}
          {isAdmin && switchBlocked && <p className="text-[15px] text-sub mb-4">{switchBlocked}</p>}
          {!isAdmin && <Helper className="mb-4">{UI.billingManagerNote}</Helper>}
          <PlanCards prices={PRICES_CENTS} interval={chooseInterval} actions={planActions} current={currentPlan} />
        </div>
      )}

      {view.kind === "complimentaryAccess" && <Helper className="mt-6">{UI.billingQuestions}</Helper>}

      {(view.kind === "subscribed" || view.kind === "complimentaryAccess") && (
        <Dialog
          open={confirm === "cancel"}
          title={UI.billingCancelTitle}
          dismissLabel={UI.billingKeepPlan}
          dismissDisabled={pending}
          onDismiss={() => setConfirm(null)}
          confirm={{
            label: pending ? UI.billingCancellingNow : UI.billingCancelPlan,
            disabled: pending,
            onConfirm: () =>
              act(
                () => cancelPlanAction(),
                view.kind === "subscribed" ? UI.billingCancelledToast : UI.billingCompUpcomingCancelled,
                () => setConfirm(null),
              ),
          }}
        >
          {/* Cancelling a plan bought during free access only stops it starting: the free access
              itself is untouched, so the "you lose access" warning would be wrong there. */}
          {view.kind === "subscribed" ? UI.billingCancelBody(dayOf(view.periodEnd)) : UI.billingCancelUpcomingBody}
        </Dialog>
      )}
    </Card>
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
