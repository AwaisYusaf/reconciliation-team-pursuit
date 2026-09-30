"use server";

/**
 * First-run tour progress (Phase 7, D-94). Per user, not per organisation: a teammate added
 * later has no rows of their own and sees every tour once, same as a brand-new sign-up.
 */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/src/db";
import { tourKey, userTourProgress, type TourKey } from "@/src/db/schema";
import { fail, ok, type ActionResult } from "@/src/lib/action-result";
import { actionSession } from "@/src/lib/action-session";

/**
 * A server action's parameter types are erased at runtime, so `tour: TourKey` is a promise the
 * caller makes, not one the runtime keeps — a crafted request can pass any string. Postgres
 * would reject an unknown value at the enum, but as a thrown error rather than a refusal, and
 * both callers here fire without awaiting a result. Checking against the enum's own values
 * keeps this a normal `fail()` and keeps the list in one place: adding a tour to the schema
 * extends this automatically.
 */
function isTourKey(value: unknown): value is TourKey {
  return typeof value === "string" && (tourKey.enumValues as readonly string[]).includes(value);
}

/**
 * Mark one tour seen — called on Finish. Skip marks every tour instead (`skipAllToursAction`,
 * D-132, which amended the spec's "Skipping or finishing means it doesn't show again", per tour,
 * after skipping on one tab kept showing the next tab's tour). `onConflictDoNothing` makes
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
  if (!isTourKey(tour)) return fail("That is not a walkthrough.");

  await db
    .insert(userTourProgress)
    .values({ userId: current.userId, tour })
    .onConflictDoNothing();

  return ok();
}

/**
 * Skip (or Escape) on any walkthrough: marks **every** tour seen for this user, so none shows on
 * another tab afterwards. Skipping used to mark only the current tab's tour, so someone who
 * skipped on Settings was walked through Add Expense on their next visit there. Finishing a tour
 * still marks only that one (`completeTourAction`), and carries on to the next tab only while a
 * walkthrough started from "Continue the tour" is running (D-135). "Show the app
 * guide again" (`resetToursAction`) and the replay button bring them back.
 */
export async function skipAllToursAction(): Promise<ActionResult> {
  const current = await actionSession();
  if ("expired" in current) return current.expired;

  await db
    .insert(userTourProgress)
    .values(tourKey.enumValues.map((tour) => ({ userId: current.userId, tour })))
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
  if (!isTourKey(tour)) return fail("That is not a walkthrough.");

  await db
    .delete(userTourProgress)
    .where(and(eq(userTourProgress.userId, current.userId), eq(userTourProgress.tour, tour)));

  return ok();
}
