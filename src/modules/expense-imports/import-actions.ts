"use server";

/**
 * The duplicate-invoice warning (Phase 14 §4, ticket §4) — a warning only, never a block: a
 * vendor really can bill the same lines twice, and the person looking at the paperwork knows
 * better than the app. The browser hashes the file it is about to upload and asks here whether
 * that hash already landed in this org/source/month; the create route recomputes the hash from
 * the bytes it actually receives, so this check is never the source of truth for what gets
 * stored.
 *
 * Its own file, not `actions.ts`/`draft-actions.ts`/`queries.ts` — those are owned by a
 * concurrently-built phase.
 */
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/src/db";
import { expenseImports, users } from "@/src/db/schema";
import { formatDateUS, todayIso } from "@/src/domain/dates";
import { userDisplay } from "@/src/domain/user-display";
import { ok, type ActionResult } from "@/src/lib/action-result";
import { actionSession } from "@/src/lib/action-session";
import { requireOwnedFundingSource } from "@/src/modules/funding-sources/queries";

export type DuplicateInvoice = { date: string; by: string | null };

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** The newest matching import in this org, source and active month — `null` when there isn't one. */
export async function checkDuplicateInvoiceAction(
  fundingSourceId: string,
  sha256: string,
): Promise<ActionResult<DuplicateInvoice | null>> {
  const session = await actionSession();
  if ("expired" in session) return session.expired;

  const source = await requireOwnedFundingSource(session, fundingSourceId);
  if ("denied" in source) return source.denied;

  // A malformed hash (never sent by the real client) simply finds nothing, rather than reaching
  // the database with a value that can't match the column's fixed length.
  if (!SHA256_HEX.test(sha256)) return ok(null);

  const [row] = await db
    .select({
      createdAt: expenseImports.createdAt,
      uploaderName: users.name,
      uploaderEmail: users.email,
    })
    .from(expenseImports)
    .leftJoin(users, eq(users.id, expenseImports.uploadedBy))
    .where(
      and(
        eq(expenseImports.orgId, session.orgId),
        eq(expenseImports.fundingSourceId, fundingSourceId),
        eq(expenseImports.month, session.activeMonth),
        eq(expenseImports.sha256, sha256),
      ),
    )
    .orderBy(desc(expenseImports.createdAt))
    .limit(1);

  if (!row) return ok(null);
  return ok({
    // The organisation's calendar date, matching every other date shown from a timestamp
    // (app/r/packet/page.tsx's `lockedEvent`).
    date: formatDateUS(todayIso(row.createdAt)),
    // Null when the uploading account has since been removed (`uploaded_by` is `ON DELETE SET
    // NULL`) — the warning then names no one, per `UI.invoiceAlreadyAdded`.
    by: row.uploaderEmail ? userDisplay(row.uploaderName, row.uploaderEmail) : null,
  });
}
