import Link from "next/link";
import { redirect } from "next/navigation";

import { pageTitle, UI } from "@/src/domain/strings";
import { signupEnabled } from "@/src/modules/auth/config";
import { isInterval, isPlanId } from "@/src/modules/billing/rules";
import { getSession, getStaffSession } from "@/src/services/auth/session";

import { AuthCard } from "@/src/components/ui/auth-card";
import { AuthSplit } from "@/src/components/ui/auth-shell";

import { SignupForm } from "./signup-form";

export const metadata = { title: pageTitle("Create your organization") };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; interval?: string }>;
}) {
  const session = await getSession();
  if (session) redirect(session.onboarded ? "/r" : "/onboarding/line-items");
  if (await getStaffSession()) redirect("/a");

  const params = await searchParams;
  const plan = isPlanId(params.plan) ? params.plan : null;
  const interval = isInterval(params.interval) ? params.interval : null;

  if (!signupEnabled()) {
    return (
      <AuthSplit>
        <AuthCard
          bare
          title={UI.signupsClosed}
          subtitle={
            <>
              This app is set up for a single organization. If you need access, contact support
              at{" "}
              <a
                href={`mailto:${UI.supportEmail}`}
                className="text-accent underline hover:text-accent-dark"
              >
                {UI.supportEmail}
              </a>
              .
            </>
          }
        >
          <Link href="/login" className="text-accent underline hover:text-accent-dark text-[15px]">
            Back to sign in
          </Link>
        </AuthCard>
      </AuthSplit>
    );
  }

  return (
    <AuthSplit>
      <AuthCard
        bare
        eyebrow={<span className="text-[14px] font-bold text-accent">Create an account</span>}
        title="Create your organization"
        subtitle="A few details and your first budget, then you can start recording expenses."
        footer={
          <>
            Already have an account?{" "}
            <Link href="/login" className="text-accent underline hover:text-accent-dark">
              Sign in
            </Link>
          </>
        }
      >
        <SignupForm plan={plan} interval={interval} />
      </AuthCard>
    </AuthSplit>
  );
}
