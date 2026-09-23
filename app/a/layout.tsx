import Image from "next/image";
import Link from "next/link";

import { PILL } from "@/src/components/app-shell/app-nav";
import { ProfileMenu } from "@/src/components/app-shell/profile-menu";
import { AppToaster } from "@/src/components/ui/toast";
import { cn } from "@/src/lib/cn";
import { requireStaffPage } from "@/src/modules/admin/guard";
import { signOutAction } from "@/src/modules/auth/actions";

/**
 * The AB Solutions staff shell (Phase 9 §6). No month or funding-source selectors, no
 * `AppNav`, no tour button — those are all customer-app concepts. `requireStaffPage()` renders
 * the shell here, but every `/a` page also calls it: Next 16 layouts don't re-render on
 * navigation, so gating here alone would let a first render's check go stale (D-98 decision 6).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaffPage();

  return (
    <div className="min-h-screen bg-paper">
      {/*
        Built to match the customer app's bar rather than sharing `AppHeader` with it. That
        component exists to collapse the mark and the account controls on scroll so the nav
        tabs survive alone, and staff have no tabs — there would be nothing left to collapse
        to, and the slots it wants (`nav`, `controls`) would both be empty.
        What is shared is what should be: the mark, the `ProfileMenu`, the 1220px column and
        the paddings.
      */}
      {/*
        No background and no bottom rule, exactly like the customer bar: there, the only solid
        thing on the row is the nav's own pill, and the bar itself is the page. A white band
        with a border underneath is the one thing the app's header deliberately is not.
      */}
      <header className="no-print sticky top-0 z-30 px-4 sm:px-6 py-2.5">
        <div className="max-w-[1220px] mx-auto flex items-center gap-3 sm:gap-4">
          <Link href="/a" aria-label="AB Solutions admin" className="shrink-0 flex items-center">
            <Image
              src="/brand/stayfunded-mark.png"
              alt=""
              width={628}
              height={570}
              className="h-8 w-auto"
              style={{ width: "auto" }}
            />
          </Link>

          {/*
            The same dark pill the nav tabs sit in on the customer side, carrying the product
            name instead of tabs — staff have no tabs, and an empty row beside the mark looked
            like a bar that had failed to load. `PILL` is imported rather than restated so the
            two bars cannot drift apart.

            White type, not `GRADIENT_TEXT`: the ramp ends in `plus-light`, which on
            `accent-dark` is a brown on a brown. The pill is the dark object here, so its label
            is reversed out of it the way the active tab's is.
          */}
          <div className="min-w-0 flex-1 flex justify-center">
            <div className={cn(PILL, "px-4 sm:px-5 py-2 max-w-full")}>
              <span className="font-sans text-[14px] sm:text-[15px] font-bold text-surface truncate block">
                AB Solutions admin
              </span>
            </div>
          </div>

          {/*
            The same avatar menu the app uses, so signing out is in the same place on both
            sides. No photo: staff accounts are a separate table with no avatar, so it falls
            back to initials on its own. `profileHref={null}` drops "Your profile", which
            points into `/r` and would sign a staff user out by accident.
          */}
          <div className="shrink-0">
            <ProfileMenu
              name={staff.name}
              email={staff.email}
              profileHref={null}
              signOut={signOutAction}
            />
          </div>
        </div>
      </header>

      <main className="max-w-[1220px] mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-12 sm:pb-16">
        {children}
      </main>
      <AppToaster />
    </div>
  );
}
