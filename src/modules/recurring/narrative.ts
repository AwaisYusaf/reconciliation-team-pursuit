/**
 * Carrying a corrected narrative back to the recurring template (R8.3, D-66).
 *
 * Its own module rather than a helper inside `actions.ts`, which is `"use server"` — every
 * export there becomes a callable endpoint, and this must not be one. Being a plain function
 * also means the rule can be tested directly instead of being restated by a test.
 */
import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/src/db";
import { recurringItems } from "@/src/db/schema";

/**
 * Update the template this expense came from, so next month's one-click add starts from the
 * current wording and nobody reopens an old month to copy it.
 *
 * Does nothing unless the expense actually came from a template, and nothing when the
 * narrative is empty: blank means "not written yet", not "delete the paragraph". Clearing is
 * done on the Recurring screen, where the field *is* the template and emptying it is plainly
 * deliberate.
 *
 * Returns whether the template was updated, so the caller can say so.
 */
export async function carryNarrativeToTemplate(input: {
  orgId: string;
  recurringItemId: string | null;
  narrative: string | null;
}): Promise<boolean> {
  const narrative = input.narrative?.trim();
  if (!input.recurringItemId || !narrative) return false;

  const updated = await db
    .update(recurringItems)
    .set({ defaultNarrative: narrative })
    .where(
      and(
        eq(recurringItems.id, input.recurringItemId),
        eq(recurringItems.orgId, input.orgId),
      ),
    )
    .returning({ id: recurringItems.id });

  return updated.length > 0;
}
