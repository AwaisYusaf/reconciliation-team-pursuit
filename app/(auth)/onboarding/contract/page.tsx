import { redirect } from "next/navigation";

import { pageSession } from "@/src/lib/page-session";

/** The old second step's URL (before funding moved first). Sends anyone still on it to the
 *  first step; the guard keeps unpaid and signed-out visitors out, like every onboarding page. */
export default async function OnboardingContractPage() {
  const session = await pageSession();
  redirect(session.onboarded ? "/r" : "/onboarding/funding");
}
