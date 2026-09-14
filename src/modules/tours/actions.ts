"use server";

/**
 * First-run tour progress (Phase 7, D-94). Per user, not per organisation: a teammate added
 * later has no rows of their own and sees every tour once, same as a brand-new sign-up.
 */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/src/db";
import { userTourProgress, type TourKey } from "@/src/db/schema";
import { ok, type ActionResult } from "@/src/lib/action-result";
import { actionSession } from "@/src/lib/action-session";

/**
 * Mark one tour seen — called on Finish **and** on Skip, which count the same for storage
 * (the spec: "Skipping or finishing means it doesn't show again"). `onConflictDoNothing` makes
 * this idempotent: the tour component calls it exactly once per dismissal, but a slow double
 * click or a retried request must not error on the primary key it already wrote.
 *
 * No `revalidatePath`: the tour hides itself immediately in client state the moment this
 * resolves, and the only thing that needs the fresh "seen" value is this same user's *next*
 * visit to that tab, which is a fresh server render regardless.
 */
export async function completeTourAction(tour: TourKey): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;

  await db
    .insert(userTourProgress)
    .values({ userId: current.userId, tour })
    .onConflictDoNothing();

  return ok();
}

/**
 * "Show the app guide again" (Settings). Deletes every tour row for the current user only —
 * never another user's, even one on the same organisation — so every tour re-arms on that
 * user's next visit to each tab.
 */
export async function resetToursAction(): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;

  await db.delete(userTourProgress).where(eq(userTourProgress.userId, current.userId));

  // Settings itself has no tour, but the next tab this user opens needs a fresh server read of
  // "have I seen this" rather than a cached one.
  revalidatePath("/", "layout");
  return ok();
}

/**
 * The header's "replay this screen's tour" (i) button — deletes only the one tour's row, not
 * every tour like `resetToursAction`, so the caller stays on the current tab and the tour
 * that belongs there simply re-arms. `router.refresh()` (called by the client component right
 * after this resolves) is what actually re-shows it: the server component above `TourGuide`
 * re-reads `hasSeenTour` and passes `alreadySeen: false` down again.
 */
export async function replayTourAction(tour: TourKey): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;

  await db
    .delete(userTourProgress)
    .where(and(eq(userTourProgress.userId, current.userId), eq(userTourProgress.tour, tour)));

  return ok();
}
