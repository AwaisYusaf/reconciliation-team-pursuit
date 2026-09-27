import type { CSSProperties } from "react";

import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { AppHeader } from "@/src/components/app-shell/app-header";
import { AppNav } from "@/src/components/app-shell/app-nav";
import { PageTransition } from "@/src/components/app-shell/page-transition";
import { FundingSourceSelector } from "@/src/components/app-shell/funding-source-selector";
import { MonthSelector } from "@/src/components/app-shell/month-selector";
import { ProfileMenu } from "@/src/components/app-shell/profile-menu";
import { TourReplayButton } from "@/src/components/app-shell/tour-replay-button";
import { AppToaster } from "@/src/components/ui/toast";
import { loadSelectableMonths } from "@/src/db/months";
import { PlusBadge } from "@/src/components/ui/plus-badge";
import { APP_NAME } from "@/src/domain/strings";
import { aiPlanAllowed } from "@/src/modules/ai/access";
import { signOutAction } from "@/src/modules/auth/actions";
import { loadBillingBanner } from "@/src/modules/billing/plan-view-loader";
import { billingEnabled } from "@/src/modules/billing/config";
import { refreshOrgBilling } from "@/src/modules/billing/sync";
import { BillingBanner } from "./billing-banner";
import { loadSourceContext } from "@/src/modules/funding-sources/queries";
import { avatarVersionOf } from "@/src/services/storage/keys";
import { getSession } from "@/src/services/auth/session";
import { hasPaidAccess } from "@/src/services/auth/entitlement";

/**
 * The authenticated shell every feature screen renders inside (m00).
 *
 * Authentication happens here rather than in `proxy.ts`: middleware only improves
 * redirect UX and is never the security boundary.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  // The "any page" lost-webhook net (P13), for paid and unpaid orgs alike: an overdue copy is
  // re-synced after the page is sent, never while it waits, so a slow Stripe can't hold up a
  // page. The next page shows the result.
  after(() => refreshOrgBilling(session.orgId, "stale"));

  // Not the gate (`pageSession()` on every page is): but it must never send org data to an
  // unpaid organization, and it must not loop — no onboarding redirect here, since an unpaid,
  // not-yet-onboarded org would otherwise bounce between this and `/r/plan` (Phase 16 §4.7).
  if (!hasPaidAccess(session)) {
    return (
      <div className="min-h-screen bg-paper">
        <AppHeader
          logo={
            <Link href="/r" aria-label={APP_NAME}>
              <Image
                src="/brand/stayfunded-mark.png"
                alt=""
                width={628}
                height={570}
                className="h-8 w-auto"
                style={{ width: "auto" }}
              />
            </Link>
          }
          nav={null}
          controls={null}
          account={
            <ProfileMenu
              name={session.userName ?? null}
              email={session.email}
              photoUrl={
                session.avatarKey ? `/api/me/avatar?v=${avatarVersionOf(session.avatarKey)}` : null
              }
              signOut={signOutAction}
            />
          }
        />
        <main className="relative max-w-[1220px] mx-auto px-4 sm:px-6 pt-3 sm:pt-4 pb-12 sm:pb-16">
          {children}
        </main>
        <AppToaster />
      </div>
    );
  }

  if (!session.onboarded) redirect("/onboarding/line-items");

  const { sources, selectedId, single } = await loadSourceContext(
    session.orgId,
    session.activeFundingSourceId,
  );

  // One list, shared with the expense form: a month the header can select must also be a
  // month an expense can be moved into.
  const months = await loadSelectableMonths(session.orgId, selectedId, [session.activeMonth]);
  const activeMonth = session.activeMonth;

  // The Plus pill follows what the org has paid for, not the plan label alone (Phase 16 §4.2):
  // `entitlement.plan` is the complimentary plan for a complimentary org, and a cancelled Plus
  // org loses the pill with the features. `resolveSession` always sets it; the fallback only
  // covers a hand-built session.
  const ent = session.entitlement;
  const showPlus = ent ? ent.paid && aiPlanAllowed(ent.plan) : aiPlanAllowed(session.plan);
  const banner = await loadBillingBanner(session);

  return (
    <div className="min-h-screen bg-paper">
      {/*
        One sticky bar carrying the mark, the tabs, the account controls and the two
        selectors. It replaces three stacked rows — the organisation name with the sign-out
        button, the month and funding-source band, and the tab row — which together ran about
        190px tall before any content appeared.

        `AppHeader` is a client component only because it watches the scroll position, to drop
        everything but the tabs once the page moves. Everything inside it is passed as a slot,
        so the data still comes from here.
      */}
      <AppHeader
        logo={
          /* The mark alone. The organisation name and wordmark were removed from the header
             at the client's request; the organisation is named on the Settings screen and on
             every document the app produces. */
          <Link href="/r" aria-label={APP_NAME}>
            <Image
              src="/brand/stayfunded-mark.png"
              alt=""
              width={628}
              height={570}
              className="h-8 w-auto"
              style={{ width: "auto" }}
            />
          </Link>
        }
        nav={<AppNav />}
        controls={
          <>
            {/* Only the AI plan gets a badge: on the plain plan a badge saying so would be
                noise on every page, forever (Phase 9). */}
            {/* A link only once billing is on: until then there is no Plan & billing to open. */}
            {showPlus && <PlusBadge href={billingEnabled() ? "/r/settings?section=plan" : undefined} />}
            <TourReplayButton />
          </>
        }
        // Its own slot, not part of `controls`, because it must not collapse on scroll — it is
        // the only way to Sign out or reach Your profile. See `AppHeader`.
        account={
          <ProfileMenu
            name={session.userName ?? null}
            email={session.email}
            // The key's uuid as a cache buster: the avatar route has no id in its path, so
            // without this a replaced photo keeps serving the old one from cache.
            photoUrl={
              session.avatarKey ? `/api/me/avatar?v=${avatarVersionOf(session.avatarKey)}` : null
            }
            signOut={signOutAction}
          />
        }
      />

      {/* The one billing notice, if any (Phase 16 §4.5). Above `main`, not inside it, so the
          floating month and funding-source selectors (absolute in `main`'s corner) never sit on it. */}
      {banner && (
        <div className="max-w-[1220px] mx-auto px-4 sm:px-6 pt-3 sm:pt-4">
          <BillingBanner banner={banner} />
        </div>
      )}

      {/* Tight against the header: the bar has its own bottom padding, so a large top padding
          here stacked on it and left a band of empty page above every screen's first line. */}
      <main
        className="relative max-w-[1220px] mx-auto px-4 sm:px-6 pt-3 sm:pt-4 pb-12 sm:pb-16"
        // How much of the content column's top-right corner the floating selectors occupy, so
        // a screen's own header can keep its title and subtext out of it (`PageHeader` reads
        // this). Published from here because this is the only place that knows: the widths are
        // set a few lines below, and whether there are one or two of them depends on `single`.
        // 150 + 10 gap + 190, or just the month pill on a single-source org.
        style={{ "--corner-width": single ? "150px" : "350px" } as CSSProperties}
      >
        {/*
          The month and funding-source selectors sit level with the screen's own title rather
          than in a band of their own above it.

          One element positioned two ways, not two copies: a hidden duplicate would put two
          nodes on the page carrying `data-tour="month-selector"`, and the walkthrough resolves
          its target by that attribute, so it would have spotlighted whichever was invisible.
          From `lg` this is lifted out of the flow into the content column's top-right corner,
          where it lands beside the first line of whatever the page renders; below that it
          stays in the flow, since a phone has no room for a title and two selectors abreast.

          This corner is now reserved. A screen with its own top-right controls (Expenses has
          Trash, Add Expense has "Extract From Invoice", the packet has its lock controls)
          clears it with `ACTION_CLEARANCE` from `surfaces.tsx` — without that they render
          underneath these and cannot be clicked.
        */}
        {/*
          `[&>*]:flex-1 [&>*]:min-w-0` below `sm`: the two pills ask for 150px and 190px, which
          is wider than a 390px phone's content column, so without it they overflow and the
          month pill is clipped to "une 2026". From `sm` they take their natural widths.
        */}
        <div className="flex justify-end gap-2 sm:gap-2.5 mb-3 [&>*]:flex-1 [&>*]:min-w-0 sm:[&>*]:flex-none lg:mb-0 lg:absolute lg:top-4 lg:right-6 lg:z-10">
          <div data-tour="month-selector">
            <MonthSelector months={months} activeMonth={activeMonth} compact />
          </div>
          {!single && (
            <div data-tour="funding-source-selector">
              <FundingSourceSelector sources={sources} selectedId={selectedId} compact />
            </div>
          )}
        </div>
        <PageTransition>{children}</PageTransition>
      </main>
      <AppToaster />
    </div>
  );
}
