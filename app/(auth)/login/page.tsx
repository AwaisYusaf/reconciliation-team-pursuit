import Link from "next/link";
import { redirect } from "next/navigation";

import { pageTitle } from "@/src/domain/strings";
import { signupEnabled } from "@/src/modules/auth/config";
import { getSession, getStaffSession } from "@/src/services/auth/session";

import { AuthCard } from "@/src/components/ui/auth-card";
import { AuthSplit } from "@/src/components/ui/auth-shell";

import { LoginForm } from "./login-form";

export const metadata = { title: pageTitle("Sign in") };

export default async function LoginPage() {
  // Real check, independent of proxy.ts.
  const session = await getSession();
  if (session) redirect(session.onboarded ? "/r" : "/onboarding/line-items");
  if (await getStaffSession()) redirect("/a");

  return (
    <AuthSplit>
      <AuthCard
        bare
        eyebrow={<span className="text-[14px] font-bold text-accent">Welcome back</span>}
        title="Sign in to your organization"
        footer={
          signupEnabled() ? (
            <>
              Don&apos;t have an account?{" "}
              <Link href="/signup" className="text-accent underline hover:text-accent-dark">
                Create an account
              </Link>
            </>
          ) : undefined
        }
      >
        <LoginForm />
      </AuthCard>
    </AuthSplit>
  );
}
