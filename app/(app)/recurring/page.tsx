import { and, asc, count, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { db } from "@/src/db";
import { expenseDocuments, expenses, lineItems, recurringItems } from "@/src/db/schema";
import { monthLabel, monthShortLabel } from "@/src/domain/dates";
import { addedState } from "@/src/domain/recurring-rules";
import { getSession } from "@/src/services/auth/session";

import { RecurringManager, type RecurringRow } from "./recurring-manager";

export const metadata = { title: "Recurring — Grant Expense Reconciliation" };

export default async function RecurringPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const month = session.activeMonth;

  const [items, options, monthRows] = await Promise.all([
    db
      .select({
        id: recurringItems.id,
        name: recurringItems.name,
        amountCents: recurringItems.amountCents,
        lineItemId: recurringItems.lineItemId,
        lineItemName: lineItems.name,
        defaultDescription: recurringItems.defaultDescription,
      })
      .from(recurringItems)
      .innerJoin(lineItems, eq(lineItems.id, recurringItems.lineItemId))
      .where(eq(recurringItems.orgId, session.orgId))
      .orderBy(asc(recurringItems.sortOrder)),
    db
      .select({ id: lineItems.id, name: lineItems.name })
      .from(lineItems)
      .where(eq(lineItems.orgId, session.orgId))
      .orderBy(asc(lineItems.sortOrder)),
    db
      .select({
        id: expenses.id,
        name: expenses.name,
        lineItemId: expenses.lineItemId,
        recurringItemId: expenses.recurringItemId,
        sortOrder: expenses.sortOrder,
        documentCount: count(expenseDocuments.id),
      })
      .from(expenses)
      .leftJoin(expenseDocuments, eq(expenseDocuments.expenseId, expenses.id))
      .where(and(eq(expenses.orgId, session.orgId), eq(expenses.month, month)))
      .groupBy(expenses.id),
  ]);

  const rows: RecurringRow[] = items.map((item) => {
    // The recurring item's own id must be passed, exactly as `addRecurringToMonthAction`
    // does. Without it `addedState` falls back to matching on name and line item, so the
    // row and the action it triggers can disagree: a one-click expense later renamed reads
    // as "not added" and adding again duplicates a salary line on the claim, while a
    // manually entered expense that merely shares a payee reads as "added" and Remove
    // deletes it.
    const state = addedState(item, monthRows, item.id);
    return {
      id: item.id,
      name: item.name,
      amountCents: item.amountCents,
      lineItemId: item.lineItemId,
      lineItemName: item.lineItemName,
      defaultDescription: item.defaultDescription ?? "",
      added: state.added,
    };
  });

  return (
    <div>
      <PageTitle className="mb-2">Recurring Items</PageTitle>
      <Subtext className="mb-[26px] max-w-[70ch]">
        Vendors and salaries billed every month. Nothing is added automatically — confirm each
        one you want to add to {monthLabel(month)}.
      </Subtext>

      <RecurringManager
        rows={rows}
        lineItems={options}
        month={month}
        monthLabel={monthLabel(month)}
        monthShort={monthShortLabel(month)}
      />
    </div>
  );
}
