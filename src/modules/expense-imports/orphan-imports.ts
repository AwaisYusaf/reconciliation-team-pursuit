import "server-only";

/**
 * Clearing away invoices nothing came of (Phase 14, D-116 follow-up).
 *
 * An import owns the stored invoice. Once every draft it produced has been discarded, and no
 * expense still points at its object, the row and the file are unreachable from any screen —
 * and because the storage quota counts `expense_imports`, they went on billing the
 * organisation against its 5 GB cap for good. Nothing deleted them.
 *
 * **Not done when the last draft is discarded**, which is the obvious place and is wrong:
 * `undoDiscardAction` re-inserts the draft with its original `import_id`, so removing the
 * import there makes Undo fail on a foreign key and the person loses the row they were
 * offered back. The suite catches exactly that.
 *
 * Done instead when the same organisation reads its NEXT invoice: by then any undo toast is
 * long gone, the work is already on a path that touches storage, and it costs one query.
 */
import { and, eq, notExists, sql } from "drizzle-orm";

import { db } from "@/src/db";
import { expenseDocuments, expenseDrafts, expenseImports } from "@/src/db/schema";
import { deleteStoredObjects } from "@/src/services/storage/documents";

export async function sweepOrphanImports(orgId: string): Promise<number> {
  const orphaned = await db
    .delete(expenseImports)
    .where(
      and(
        eq(expenseImports.orgId, orgId),
        // No draft still waiting to be reviewed...
        notExists(
          db
            .select({ one: sql`1` })
            .from(expenseDrafts)
            .where(eq(expenseDrafts.importId, expenseImports.id)),
        ),
        // ...and no expense using the invoice as its receipt. Approval re-points the same
        // object rather than copying it, so an import can have no drafts left while its file
        // is still the receipt on a dozen real expenses.
        notExists(
          db
            .select({ one: sql`1` })
            .from(expenseDocuments)
            .where(eq(expenseDocuments.s3Key, expenseImports.s3Key)),
        ),
      ),
    )
    .returning({ key: expenseImports.s3Key });

  // After the rows are gone, so an import no longer counts as a reference to its own object.
  // `deleteStoredObjects` still checks, and skips anything another row picked up meanwhile.
  for (const row of orphaned) {
    await deleteStoredObjects(row.key);
  }
  return orphaned.length;
}
