import { redirect } from "next/navigation";

import { getSession } from "@/src/services/auth/session";
import { pageTitle } from "@/src/domain/strings";

import { OnboardingContractForm } from "./contract-form";
import { AuthCard } from "@/src/components/ui/auth-card";
import { AuthCentered } from "@/src/components/ui/auth-shell";
import { Eyebrow } from "@/src/components/ui/surfaces";

export const metadata = { title: pageTitle("Your contract") };

export default async function OnboardingContractPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.onboarded) redirect("/r");

  return (
    <AuthCentered>
      <AuthCard
        width="lg"
        eyebrow={<Eyebrow>Step 2 of 2</Eyebrow>}
        title="Your contract"
        subtitle="These details appear on the summary sheet you send for review."
      >
        <OnboardingContractForm />
      </AuthCard>
    </AuthCentered>
  );
}
