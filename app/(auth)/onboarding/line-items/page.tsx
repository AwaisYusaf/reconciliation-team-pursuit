import { redirect } from "next/navigation";

import { db } from "@/src/db";
import { lineItems } from "@/src/db/schema";
import { getSession } from "@/src/services/auth/session";
import { asc, eq } from "drizzle-orm";

import { OnboardingLineItemsForm } from "./line-items-form";
import { Eyebrow, PageTitle } from "@/src/components/ui/surfaces";

export const metadata = { title: "Set up your budget — Grant Expense Reconciliation" };

/** Starter categories, names only — budgets are the organisation's to enter (review B10). */
const STARTER_NAMES = [
  "Salary",
  "Analytical Support",
  "Promotional & Marketing",
  "Social Services & Support",
  "Community Programs & Events",
  "Professional Development",
];

export default async function OnboardingLineItemsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.onboarded) redirect("/");

  // Step 1 saves immediately, so a returning user resumes with what they already typed.
  const existing = await db
    .select({ name: lineItems.name, cents: lineItems.scheduledValueCents })
    .from(lineItems)
    .where(eq(lineItems.orgId, session.orgId))
    .orderBy(asc(lineItems.sortOrder));

  const initialRows =
    existing.length > 0
      ? existing.map((row) => ({ name: row.name, budget: (row.cents / 100).toFixed(2) }))
      : STARTER_NAMES.map((name) => ({ name, budget: "" }));

  return (
    <div className="w-full max-w-[720px] bg-surface border border-line rounded-[4px] p-5 sm:p-8">
      <Eyebrow>Step 1 of 2</Eyebrow>
      <PageTitle className="leading-tight mt-2.5 mb-2">Set up your budget line items</PageTitle>
      <p className="text-[15px] text-sub leading-relaxed m-0 mb-[26px] max-w-[60ch]">
        These are the categories your funder approved. You can change them later.
      </p>

      <OnboardingLineItemsForm initialRows={initialRows} />
    </div>
  );
}
