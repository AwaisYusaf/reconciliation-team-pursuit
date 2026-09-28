import Link from "next/link";
import { eq } from "drizzle-orm";

import { Card, CARD_PADDING, PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { db } from "@/src/db";
import { organizations } from "@/src/db/schema";
import { formatDateUS } from "@/src/domain/dates";
import { pageTitle, UI } from "@/src/domain/strings";
import { planPageSession } from "@/src/lib/page-session";
import { complimentaryEndedOn, ORG_ENTITLEMENT_COLUMNS } from "@/src/services/auth/entitlement";
import { loadPlanBilling } from "@/src/modules/billing/plan-view-loader";
import { PRICES_CENTS } from "@/src/modules/billing/pricing";
import { INTERVALS, isInterval, isPlanId, type Interval, type PlanId } from "@/src/modules/billing/rules";
import { PLAN_CARD_IDS, PlanCards } from "@/src/modules/landing/plan-cards";

import { PlanBillingSection } from "../plan-billing-section";
import { SubscribeButton } from "../subscribe-button";

// Not "Choose a plan": a plan on hold shows its Plan & billing panel here instead (D-126).
export const metadata = { title: pageTitle("Plan & billing") };

function planHref(interval: Interval, plan: PlanId | null): string {
  const params = new URLSearchParams({ interval });
  if (plan) params.set("plan", plan);
  return `/r/plan?${params.toString()}`;
}

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; interval?: string; checkout?: string }>;
}) {
  // The gate: never redirects a paid org back here (that would loop), sends everyone else
  // straight to sign in (Phase 16 §4.7).
  const session = await planPageSession();

  // A plan on hold (Stripe stopped retrying a failed payment, or paused it) can't be replaced by
  // a new one, so the chooser would only refuse. Show the plan instead, with Card and invoices to
  // pay or change the card in Stripe and End plan now: the admin sorts it out without asking
  // anyone (Phase 16, D-126). Only billing is shown; the org's records stay behind the paywall.
  const billing = await loadPlanBilling(session);
  if (billing.view.kind === "subscribed" && billing.view.onHold) {
    return (
      <div className="max-w-3xl mx-auto">
        <PlanBillingSection data={billing} />
      </div>
    );
  }

  const params = await searchParams;
  const interval: Interval = isInterval(params.interval) ? params.interval : "month";
  const preselected = isPlanId(params.plan) ? params.plan : null;

  const [org] = await db
    .select({ name: organizations.name, ...ORG_ENTITLEMENT_COLUMNS })
    .from(organizations)
    .where(eq(organizations.id, session.orgId))
    .limit(1);
  const orgName = org?.name ?? session.orgName;
  const compEndedOn = org ? complimentaryEndedOn(org) : null;

  const isAdmin = session.role === "admin";

  // Never paid here (`planPageSession` sends a paid org on), so the reason is always one of
  // the four `orgEntitlement` gives an unpaid org. Falls back to the "new" wording rather than
  // throwing: a session built without `entitlement` (a stale cookie mid-deploy) should still
  // show a chooser, not a 500.
  const reason = session.entitlement?.reason ?? "new";
  const headline =
    reason === "complimentary_ended" && compEndedOn
      ? UI.billingCompEnded(formatDateUS(compEndedOn))
      : reason === "new"
        ? UI.billingChooseNew
        : UI.billingEnded;

  const plansToShow = preselected ? [preselected] : PLAN_CARD_IDS;
  const managerNoticeNames = billing.adminNames; // "" for an admin
  // Reconciliation includes one active funding source (C8): with more, choosing it asks which
  // one to keep, and the rest are archived once the payment goes through (D-129). Asked only
  // after that choice, never shown up front.
  const { activeSources } = billing;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center mb-8">
        <PageTitle className="mb-1.5">{UI.billingChooseFor(orgName)}</PageTitle>
        <Subtext>{headline}</Subtext>
      </div>

      {/* Stripe sends an admin who backed out of Checkout here (`PLAN_CANCELLED_PATH`). A calm
          note, not an error: nothing happened and nothing was charged. */}
      {params.checkout === "cancelled" && isAdmin && (
        <Card className={`${CARD_PADDING} mb-6 text-center`}>
          <p className="text-[15px] text-ink">{UI.billingCheckoutAbandoned}</p>
        </Card>
      )}

      {!isAdmin ? (
        <Card className={`${CARD_PADDING} text-center`}>
          <Subtext>{UI.billingUnpaidManager(managerNoticeNames)}</Subtext>
        </Card>
      ) : (
        <>
          {/* The landing page's pill toggle, as links: the chooser is a server page, and the
              interval in the URL survives a reload and the back button. */}
          <div className="flex flex-col items-center gap-3 mb-8">
            <div
              role="group"
              aria-label="Billing interval"
              className="inline-flex items-center gap-1 p-1 rounded-full bg-lp-surface-container-high border border-outline-variant"
            >
              {INTERVALS.map((value) => (
                <Link
                  key={value}
                  href={planHref(value, preselected)}
                  aria-current={interval === value ? "true" : undefined}
                  className={
                    interval === value
                      ? "min-h-11 px-4 inline-flex items-center rounded-full text-sm font-semibold text-white glass-btn glass-btn-primary"
                      : "min-h-11 px-4 inline-flex items-center rounded-full text-sm font-semibold text-brand-800 hover:bg-lp-surface-container transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  }
                >
                  {value === "month" ? UI.billingIntervalMonthly : UI.billingIntervalYearly}
                </Link>
              ))}
            </div>
            {preselected && (
              <Link href={planHref(interval, null)} className="text-[15px] text-accent underline hover:text-accent-dark">
                {UI.billingChooseDifferent}
              </Link>
            )}
          </div>

          <div className={preselected ? "flex justify-center" : undefined}>
            <PlanCards
              prices={PRICES_CENTS}
              interval={interval}
              plans={plansToShow}
              actions={(plan) => (
                <SubscribeButton
                  plan={plan}
                  interval={interval}
                  primary={plan === "reconciliation_ai"}
                  keepOneOf={plan === "reconciliation" && activeSources.length > 1 ? activeSources : undefined}
                />
              )}
            />
          </div>
        </>
      )}
    </div>
  );
}
