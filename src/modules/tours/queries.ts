import "server-only";

/**
 * Per-user tour-seen lookups (Phase 7, D-94).
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/src/db";
import { userTourProgress, type TourKey } from "@/src/db/schema";

/** True once the user has finished or skipped this tour — both write the same row (§3.3). */
export async function hasSeenTour(userId: string, tour: TourKey): Promise<boolean> {
  const [row] = await db
    .select({ tour: userTourProgress.tour })
    .from(userTourProgress)
    .where(and(eq(userTourProgress.userId, userId), eq(userTourProgress.tour, tour)))
    .limit(1);
  return row !== undefined;
}
