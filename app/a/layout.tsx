import { Button } from "@/src/components/ui/button";
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
      <header className="bg-surface border-b border-line px-4 sm:px-6 py-3 sm:py-[18px] flex gap-4 items-center justify-between">
        <div className="min-w-0">
          <div className="font-serif text-lg sm:text-xl lg:text-2xl font-bold leading-tight text-ink truncate">
            AB Solutions admin
          </div>
          <div className="text-[13px] sm:text-[15px] text-sub mt-0.5 sm:mt-1 truncate">
            {staff.name}
          </div>
        </div>
        <div className="shrink-0">
          <form action={signOutAction}>
            <Button type="submit" variant="secondary" className="min-h-11 sm:min-h-12 text-[15px]">
              Log out
            </Button>
          </form>
        </div>
      </header>

      <main className="max-w-[1220px] mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-12 sm:pb-16">
        {children}
      </main>
      <AppToaster />
    </div>
  );
}
