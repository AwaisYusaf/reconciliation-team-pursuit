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
import { contractSettings, expenses } from "@/src/db/schema";
import { contractMonths, monthWindow, type MonthKey } from "@/src/domain/dates";

export async function loadSelectableMonths(
  orgId: string,
  alsoInclude: readonly MonthKey[] = [],
): Promise<MonthKey[]> {
  const [monthRows, contractRows] = await Promise.all([
    // A month holding only trashed rows is not selectable.
    db
      .selectDistinct({ month: expenses.month })
      .from(expenses)
      .where(and(eq(expenses.orgId, orgId), isNull(expenses.deletedAt))),
    db
      .select({ start: contractSettings.contractStart, end: contractSettings.contractEnd })
      .from(contractSettings)
      .where(eq(contractSettings.orgId, orgId))
      .limit(1),
  ]);

  return monthWindow([
    ...contractMonths(contractRows[0]?.start, contractRows[0]?.end),
    ...monthRows.map((row) => row.month),
    ...alsoInclude,
  ]);
}
