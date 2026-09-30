import { redirect } from "next/navigation";

import { AuthCard } from "@/src/components/ui/auth-card";
import { AuthCentered } from "@/src/components/ui/auth-shell";
import { Eyebrow } from "@/src/components/ui/surfaces";
import { formatMoneyInput } from "@/src/domain/format";
import { pageTitle, UI } from "@/src/domain/strings";
import { pageSession } from "@/src/lib/page-session";
import { findFundingSource, primaryFundingSourceId } from "@/src/modules/funding-sources/queries";

import { OnboardingSignOut } from "../sign-out";
import { OnboardingFundingForm } from "./funding-form";

export const metadata = { title: pageTitle("Your funding") };

/** Onboarding step 1 (m00): the funding, saved onto the organisation's first funding source. */
export default async function OnboardingFundingPage({
  searchParams,
}: {
  searchParams: Promise<{ paid?: string | string[] }>;
}) {
  // A display hint from the billing return route only; nothing trusts it.
  const paid = (await searchParams).paid === "1";
  const session = await pageSession();
  if (session.onboarded) redirect("/r");

  const source = await findFundingSource(session.orgId, await primaryFundingSourceId(session.orgId));
  if (!source) throw new Error("Organisation has no funding source.");
  // Step 1 is done once the total is saved; before that the name is still sign-up's "Source 1".
  const saved = source.contractValueCents > 0;

  return (
    <AuthCentered>
      <AuthCard
        width="lg"
        eyebrow={<Eyebrow>Step 1 of 2</Eyebrow>}
        title="Your funding"
        subtitle="The money your budget comes from. You can change these details later in Settings."
        footer={<OnboardingSignOut email={session.email} />}
      >
        {paid && (
          <p
            role="status"
            className="mb-5 rounded-[10px] bg-success-bg text-success px-4 py-2.5 text-[15px] font-semibold"
          >
            {UI.onboardingPaymentReceived}
          </p>
        )}
        <OnboardingFundingForm
          initial={{
            name: saved ? source.name : "",
            total: saved ? formatMoneyInput(source.contractValueCents) : "",
            start: source.contractStart ?? "",
            end: source.contractEnd ?? "",
            fiduciary: source.fiduciaryName,
          }}
          rulesLine={UI.onboardingRules(source.taxReimbursable, source.feesReimbursable)}
        />
      </AuthCard>
    </AuthCentered>
  );
}
