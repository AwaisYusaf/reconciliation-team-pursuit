import "server-only";

/**
 * The months an organisation can select, in one place.
 *
 * The app shell's selector and the expense form's Month dropdown must offer the same set: a
 * month you can view but cannot move an expense into is a dead end, and that is exactly what
 * happened when the form built its own narrower list from `monthWindow` alone (D-62 added
 * contract months to the header and not to the form).
 */
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/src/db";
import { expenses, fundingSources } from "@/src/db/schema";
import { contractMonths, monthWindow, type MonthKey } from "@/src/domain/dates";

/**
 * `fundingSourceId` scopes both queries below; `null` (All) unions every one of the org's
 * sources' contract months and expense months, rather than picking one.
 */
export async function loadSelectableMonths(
  orgId: string,
  fundingSourceId: string | null,
  alsoInclude: readonly MonthKey[] = [],
): Promise<MonthKey[]> {
  const [monthRows, contractRows] = await Promise.all([
    // A month holding only trashed rows is not selectable.
    db
      .selectDistinct({ month: expenses.month })
      .from(expenses)
      .where(
        and(
          eq(expenses.orgId, orgId),
          fundingSourceId ? eq(expenses.fundingSourceId, fundingSourceId) : undefined,
          isNull(expenses.deletedAt),
        ),
      ),
    db
      .select({ start: fundingSources.contractStart, end: fundingSources.contractEnd })
      .from(fundingSources)
      .where(
        and(
          eq(fundingSources.orgId, orgId),
          fundingSourceId ? eq(fundingSources.id, fundingSourceId) : undefined,
        ),
      ),
  ]);

  return monthWindow([
    ...contractRows.flatMap((row) => contractMonths(row.start, row.end)),
    ...monthRows.map((row) => row.month),
    ...alsoInclude,
  ]);
}
