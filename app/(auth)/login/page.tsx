import Link from "next/link";
import { redirect } from "next/navigation";

import { signupEnabled } from "@/src/modules/auth/config";
import { getSession, getStaffSession } from "@/src/services/auth/session";

import { PageTitle } from "@/src/components/ui/surfaces";

import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — Grant Expense Reconciliation" };

export default async function LoginPage() {
  // Real check, independent of proxy.ts.
  const session = await getSession();
  if (session) redirect(session.onboarded ? "/r" : "/onboarding/line-items");
  if (await getStaffSession()) redirect("/a");

  return (
    <div className="w-full max-w-[440px] bg-surface border border-line rounded-[4px] px-8 pt-9 pb-8">
      <div className="font-serif text-[15px] text-sub tracking-[0.02em]">
        Grant Expense Reconciliation
      </div>
      <PageTitle className="leading-tight mt-2.5 mb-6 sm:mb-[26px]">Sign in to your organization</PageTitle>

      <LoginForm />

      {signupEnabled() && (
        <div className="border-t border-line mt-6 pt-5 text-center text-[15px] text-sub">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-accent underline hover:text-accent-dark">
            Create an account
          </Link>
        </div>
      )}
    </div>
  );
}
