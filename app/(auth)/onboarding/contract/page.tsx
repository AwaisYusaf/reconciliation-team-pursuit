import { redirect } from "next/navigation";

import { getSession } from "@/src/services/auth/session";

import { OnboardingContractForm } from "./contract-form";

export const metadata = { title: "Your contract — Grant Expense Reconciliation" };

export default async function OnboardingContractPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.onboarded) redirect("/");

  return (
    <div className="w-full max-w-[720px] bg-surface border border-line rounded-[4px] p-8">
      <div className="text-[13px] uppercase tracking-[0.1em] text-sub font-bold">Step 2 of 2</div>
      <h1 className="font-serif text-[28px] font-bold leading-tight mt-2.5 mb-2 text-ink">
        Your contract
      </h1>
      <p className="text-[15px] text-sub leading-relaxed m-0 mb-[26px] max-w-[60ch]">
        This appears on the summary sheet you send for review.
      </p>

      <OnboardingContractForm />
    </div>
  );
}
