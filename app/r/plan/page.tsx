import Link from "next/link";
import { eq } from "drizzle-orm";

import { Card, CARD_PADDING, PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { db } from "@/src/db";
import { organizations } from "@/src/db/schema";
import { formatDateUS } from "@/src/domain/dates";
import { pageTitle, UI } from "@/src/domain/strings";
import { planPageSession } from "@/src/lib/page-session";
import { complimentaryEndedOn, ENTITLEMENT_COLUMNS } from "@/src/services/auth/entitlement";
import { activeAdminNames } from "@/src/modules/billing/plan-view-loader";
import { PRICES_CENTS } from "@/src/modules/billing/pricing";
import { INTERVALS, isInterval, isPlanId, type Interval, type PlanId } from "@/src/modules/billing/rules";
import { PLAN_CARD_IDS, PlanCards } from "@/src/modules/landing/plan-cards";

import { SubscribeButton } from "./subscribe-button";

export const metadata = { title: pageTitle("Choose a plan") };

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

  const params = await searchParams;
  const interval: Interval = isInterval(params.interval) ? params.interval : "month";
  const preselected = isPlanId(params.plan) ? params.plan : null;

  const [org] = await db
    .select({ name: organizations.name, ...ENTITLEMENT_COLUMNS })
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
  const managerNoticeNames = isAdmin ? "" : await activeAdminNames(session.orgId);

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
                <SubscribeButton plan={plan} interval={interval} primary={plan === "reconciliation_ai"} />
              )}
            />
          </div>
        </>
      )}
    </div>
  );
}
