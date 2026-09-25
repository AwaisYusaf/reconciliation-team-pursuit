import Link from "next/link";
import { eq } from "drizzle-orm";

import { Card, CARD_PADDING, PageTitle, SectionTitle, Subtext } from "@/src/components/ui/surfaces";
import { db } from "@/src/db";
import { organizations } from "@/src/db/schema";
import { formatDateUS } from "@/src/domain/dates";
import { formatMoney } from "@/src/domain/format";
import { pageTitle, PLAN_LABELS, UI } from "@/src/domain/strings";
import { planPageSession } from "@/src/lib/page-session";
import { complimentaryEndedOn, ENTITLEMENT_COLUMNS } from "@/src/services/auth/entitlement";
import { activeAdminNames } from "@/src/modules/billing/plan-view-loader";
import { priceCents } from "@/src/modules/billing/pricing";
import { INTERVALS, isInterval, isPlanId, type Interval, type PlanId } from "@/src/modules/billing/rules";

import { SubscribeButton } from "./subscribe-button";

export const metadata = { title: pageTitle("Choose a plan") };

const PLAN_IDS: readonly PlanId[] = ["reconciliation", "reconciliation_ai"];

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
  // straight to sign in (Phase 15 §4.7).
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

  const plansToShow = preselected ? [preselected] : PLAN_IDS;
  const managerNoticeNames = isAdmin ? "" : await activeAdminNames(session.orgId);

  return (
    <div>
      <PageTitle className="mb-1.5">{UI.billingChooseFor(orgName)}</PageTitle>
      <Subtext className="mb-6">{headline}</Subtext>

      {/* Stripe sends an admin who backed out of Checkout here (`PLAN_CANCELLED_PATH`). A calm
          note, not an error: nothing happened and nothing was charged. */}
      {params.checkout === "cancelled" && isAdmin && (
        <Card className={`${CARD_PADDING} mb-6`}>
          <p className="text-[15px] text-ink">{UI.billingCheckoutAbandoned}</p>
        </Card>
      )}

      {!isAdmin ? (
        <Card className={CARD_PADDING}>
          <Subtext>{UI.billingUnpaidManager(managerNoticeNames)}</Subtext>
        </Card>
      ) : (
        <>
          <div className="flex gap-2 mb-4" role="group" aria-label="Billing interval">
            {INTERVALS.map((value) => (
              <Link
                key={value}
                href={planHref(value, preselected)}
                aria-current={interval === value ? "true" : undefined}
                className={
                  "min-h-11 px-4 inline-flex items-center rounded-[3px] text-[15px] font-bold border " +
                  (interval === value
                    ? "bg-accent text-surface border-accent"
                    : "bg-surface text-accent border-accent hover:bg-section")
                }
              >
                {value === "month" ? UI.billingIntervalMonthly : UI.billingIntervalYearly}
              </Link>
            ))}
          </div>

          {preselected && (
            <Link
              href={planHref(interval, null)}
              className="inline-block mb-4 text-[15px] text-accent underline hover:text-accent-dark"
            >
              {UI.billingChooseDifferent}
            </Link>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {plansToShow.map((plan) => (
              <Card key={plan} className={CARD_PADDING}>
                <SectionTitle className="mb-2">{PLAN_LABELS[plan]}</SectionTitle>
                <p className="text-2xl font-bold text-ink mb-4">
                  {formatMoney(priceCents(plan, interval))}
                  {interval === "month" ? UI.billingPerMonth : UI.billingPerYear}
                </p>
                <SubscribeButton plan={plan} interval={interval} />
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
