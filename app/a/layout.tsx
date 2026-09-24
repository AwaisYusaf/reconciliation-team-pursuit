import Image from "next/image";
import Link from "next/link";

import { ProfileMenu } from "@/src/components/app-shell/profile-menu";
import { AppToaster } from "@/src/components/ui/toast";
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
        Opaque, with a rule under it. The customer bar gets away with being transparent because
        the only thing on it that must stay readable is the nav pill, which is solid and carries
        its own background; everything else there can be scrolled over. This bar is mostly empty
        space, so transparent meant the page scrolled up through it and the title rendered
        straight across the wordmark.
      */}
      <header className="no-print sticky top-0 z-30 bg-surface border-b border-line px-4 sm:px-6 py-2.5">
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
            name instead of tabs, since staff have no tabs.

            Written out rather than imported from `AppNav`'s `PILL`. Tailwind finds classes by
            scanning source text, and a class that only ever reaches an element through an
            imported constant is a class this file never contains — which is how the pill
            rendered with white type and no background at all.

            White type, not `GRADIENT_TEXT`: the ramp ends in `plus-light`, which on
            `accent-dark` is a brown on a brown. The pill is the dark object here, so its label
            is reversed out of it the way the active tab's is.
          */}
          <div className="min-w-0 flex-1 flex justify-center">
            <div className="rounded-full bg-accent-dark shadow-[0_2px_12px_rgba(33,27,22,0.18)] px-4 sm:px-5 py-2 max-w-full">
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
