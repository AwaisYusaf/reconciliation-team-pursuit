import Link from "next/link";
import { redirect } from "next/navigation";

import { UI } from "@/src/domain/strings";
import { signupEnabled } from "@/src/modules/auth/config";
import { getSession } from "@/src/services/auth/session";

import { SignupForm } from "./signup-form";

export const metadata = { title: "Create your organisation — Grant Expense Reconciliation" };

export default async function SignupPage() {
  const session = await getSession();
  if (session) redirect(session.onboarded ? "/" : "/onboarding/line-items");

  if (!signupEnabled()) {
    return (
      <div className="w-full max-w-[440px] bg-surface border border-line rounded-[4px] px-8 pt-9 pb-8 text-center">
        <h1 className="font-serif text-[28px] font-bold text-ink mb-4">{UI.signupsClosed}</h1>
        <p className="text-[15px] text-sub leading-relaxed mb-6">
          This system is set up for a single organisation. Contact Mantaq if you need access.
        </p>
        <Link href="/login" className="text-accent underline hover:text-accent-dark text-[15px]">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[440px] bg-surface border border-line rounded-[4px] px-8 pt-9 pb-8">
      <div className="font-serif text-[15px] text-sub tracking-[0.02em]">
        Grant Expense Reconciliation
      </div>
      <h1 className="font-serif text-[28px] font-bold leading-tight mt-2.5 mb-[26px] text-ink">
        Create your organisation
      </h1>

      <SignupForm />

      <div className="border-t border-line mt-6 pt-5 text-center text-[15px] text-sub">
        Already have an account?{" "}
        <Link href="/login" className="text-accent underline hover:text-accent-dark">
          Sign in
        </Link>
      </div>
    </div>
  );
}
