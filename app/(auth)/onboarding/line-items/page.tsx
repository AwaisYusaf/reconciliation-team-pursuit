import { redirect } from "next/navigation";

import { db } from "@/src/db";
import { lineItems } from "@/src/db/schema";
import { pageSession } from "@/src/lib/page-session";
import { asc, eq } from "drizzle-orm";
import { pageTitle } from "@/src/domain/strings";

import { OnboardingLineItemsForm } from "./line-items-form";
import { AuthCard } from "@/src/components/ui/auth-card";
import { AuthCentered } from "@/src/components/ui/auth-shell";
import { Eyebrow } from "@/src/components/ui/surfaces";

export const metadata = { title: pageTitle("Set up your budget") };

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
  const session = await pageSession();
  if (session.onboarded) redirect("/r");

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
    <AuthCentered>
      <AuthCard
        width="lg"
        eyebrow={<Eyebrow>Step 1 of 2</Eyebrow>}
        title="Set up your budget line items"
        subtitle="These are the categories your funder approved. You can change them later."
      >
        <OnboardingLineItemsForm initialRows={initialRows} />
      </AuthCard>
    </AuthCentered>
  );
}
