import { redirect } from "next/navigation";

import { db } from "@/src/db";
import { lineItems } from "@/src/db/schema";
import { pageSession } from "@/src/lib/page-session";
import { and, asc, eq } from "drizzle-orm";
import { formatMoneyInput } from "@/src/domain/format";
import { pageTitle } from "@/src/domain/strings";
import { findFundingSource, primaryFundingSourceId } from "@/src/modules/funding-sources/queries";

import { OnboardingSignOut } from "../sign-out";
import { OnboardingLineItemsForm } from "./line-items-form";
import { AuthCard } from "@/src/components/ui/auth-card";
import { AuthCentered } from "@/src/components/ui/auth-shell";
import { Eyebrow } from "@/src/components/ui/surfaces";

export const metadata = { title: pageTitle("Your budget line items") };

/** Starter categories, names only — budgets are the organisation's to enter (review B10). */
const STARTER_NAMES = [
  "Salary",
  "Analytical Support",
  "Promotional & Marketing",
  "Social Services & Support",
  "Community Programs & Events",
  "Professional Development",
];

/**
 * Onboarding step 2 (m00). Also the entry every "not onboarded yet" redirect uses, so it sends
 * an organisation whose funding isn't saved yet on to step 1.
 */
export default async function OnboardingLineItemsPage() {
  const session = await pageSession();
  if (session.onboarded) redirect("/r");

  const fundingSourceId = await primaryFundingSourceId(session.orgId);
  const source = await findFundingSource(session.orgId, fundingSourceId);
  if (!source || source.contractValueCents <= 0) redirect("/onboarding/funding");

  // Line items saved by the previous flow (which saved them before finishing) come back as the
  // starting rows.
  const existing = await db
    .select({ name: lineItems.name, cents: lineItems.scheduledValueCents })
    .from(lineItems)
    .where(and(eq(lineItems.orgId, session.orgId), eq(lineItems.fundingSourceId, fundingSourceId)))
    .orderBy(asc(lineItems.sortOrder));

  const initialRows =
    existing.length > 0
      ? existing.map((row) => ({ name: row.name, budget: formatMoneyInput(row.cents) }))
      : STARTER_NAMES.map((name) => ({ name, budget: "" }));

  return (
    <AuthCentered>
      <AuthCard
        width="lg"
        eyebrow={<Eyebrow>Step 2 of 2</Eyebrow>}
        title="Your budget line items"
        subtitle={
          existing.length > 0
            ? "Split your total into the line items your funder approved. You can change them later."
            : "Split your total into the line items your funder approved. The names below are examples: rename them, and remove any you don't need."
        }
        footer={<OnboardingSignOut email={session.email} />}
      >
        <OnboardingLineItemsForm
          orgId={session.orgId}
          initialRows={initialRows}
          totalCents={source.contractValueCents}
        />
      </AuthCard>
    </AuthCentered>
  );
}
