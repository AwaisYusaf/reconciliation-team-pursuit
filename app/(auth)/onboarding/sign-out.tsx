import { signOutAction } from "@/src/modules/auth/actions";

/** "Signed in as" and a way out, under both onboarding steps (m00). */
export function OnboardingSignOut({ email }: { email: string }) {
  return (
    <form action={signOutAction} className="flex flex-wrap items-center justify-center gap-x-2">
      <span>Signed in as {email}.</span>
      <button type="submit" className="min-h-11 text-accent underline hover:text-accent-dark">
        Sign out
      </button>
    </form>
  );
}
