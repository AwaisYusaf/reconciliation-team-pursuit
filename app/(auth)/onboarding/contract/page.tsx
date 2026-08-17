import { redirect } from "next/navigation";

import { getSession } from "@/src/services/auth/session";

import { OnboardingContractForm } from "./contract-form";
import { Eyebrow, PageTitle } from "@/src/components/ui/surfaces";

export const metadata = { title: "Your contract — Grant Expense Reconciliation" };

export default async function OnboardingContractPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.onboarded) redirect("/");

  return (
    <div className="w-full max-w-[720px] bg-surface border border-line rounded-[4px] p-5 sm:p-8">
      <Eyebrow>Step 2 of 2</Eyebrow>
      <PageTitle className="leading-tight mt-2.5 mb-2">Your contract</PageTitle>
      <p className="text-[15px] text-sub leading-relaxed m-0 mb-[26px] max-w-[60ch]">
        This appears on the summary sheet you send for review.
      </p>

      <OnboardingContractForm />
    </div>
  );
}
