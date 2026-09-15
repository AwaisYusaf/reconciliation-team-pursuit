import { and, asc, count, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";

import { PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { TourGuide } from "@/src/components/ui/tour";
import { db } from "@/src/db";
import { expenseDocuments, expenses, lineItems, paymentSources, recurringItems } from "@/src/db/schema";
import { monthLabel, monthShortLabel } from "@/src/domain/dates";
import { addedState } from "@/src/domain/recurring-rules";
import { loadSourceContext } from "@/src/modules/funding-sources/queries";
import { loadLockedMonths } from "@/src/modules/packet/queries";
import { RECURRING_TOUR_STEPS } from "@/src/modules/tours/recurring-tour";
import { hasSeenTour } from "@/src/modules/tours/queries";
import { getSession } from "@/src/services/auth/session";

import { RecurringManager, type RecurringRow } from "./recurring-manager";

export const metadata = { title: "Recurring — Grant Expense Reconciliation" };

export default async function RecurringPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const month = session.activeMonth;
  const seenRecurringTour = await hasSeenTour(session.userId, "recurring");

  const { sources: fundingSources, selectedId: fundingSourceId } = await loadSourceContext(
    session.orgId,
    session.activeFundingSourceId,
  );
  const multiSource = fundingSources.length > 1;
  const sourceNameById = new Map(fundingSources.map((source) => [source.id, source.name]));
  const archivedSourceIds = new Set(
    fundingSources.filter((source) => source.archivedAt !== null).map((source) => source.id),
  );

  const [items, options, sources, monthRows, lockedMonthKeys] = await Promise.all([
    db
      .select({
        id: recurringItems.id,
        name: recurringItems.name,
        amountCents: recurringItems.amountCents,
        lineItemId: recurringItems.lineItemId,
        lineItemName: lineItems.name,
        fundingSourceId: lineItems.fundingSourceId,
        defaultDescription: recurringItems.defaultDescription,
        defaultNarrative: recurringItems.defaultNarrative,
        defaultPaymentSource: recurringItems.defaultPaymentSource,
        defaultTaxCents: recurringItems.defaultTaxCents,
        defaultFeesCents: recurringItems.defaultFeesCents,
      })
      .from(recurringItems)
      .innerJoin(lineItems, eq(lineItems.id, recurringItems.lineItemId))
      .where(
        and(
          eq(recurringItems.orgId, session.orgId),
          // "All" (null) loads every source's recurring items; a chosen source scopes as before.
          fundingSourceId ? eq(lineItems.fundingSourceId, fundingSourceId) : undefined,
        ),
      )
      .orderBy(asc(recurringItems.sortOrder)),
    db
      .select({ id: lineItems.id, name: lineItems.name, fundingSourceId: lineItems.fundingSourceId })
      .from(lineItems)
      .where(
        and(
          eq(lineItems.orgId, session.orgId),
          fundingSourceId ? eq(lineItems.fundingSourceId, fundingSourceId) : undefined,
        ),
      )
      .orderBy(asc(lineItems.sortOrder)),
    db
      .select({ label: paymentSources.label })
      .from(paymentSources)
      .where(and(eq(paymentSources.orgId, session.orgId), eq(paymentSources.active, true)))
      .orderBy(asc(paymentSources.sortOrder)),
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
      .where(
        and(
          eq(expenses.orgId, session.orgId),
          // Scoped the same way as `items` above: every source's rows with All selected.
          fundingSourceId ? eq(expenses.fundingSourceId, fundingSourceId) : undefined,
          eq(expenses.month, month),
          isNull(expenses.deletedAt),
        ),
      )
      .groupBy(expenses.id),
    loadLockedMonths(session.orgId, null),
  ]);

  // The picker offers only line items a template can be saved on — an archived source takes no
  // new expenses, so `saveRecurringItemAction` refuses it — and, when the org has more than one
  // source, says which source each belongs to: two sources may each have a "Salary". `label`
  // is display only; `name` stays the bare line item name the filters match on.
  const pickerLineItems = options
    .filter((item) => !archivedSourceIds.has(item.fundingSourceId))
    .map((item) => ({
      id: item.id,
      name: item.name,
      label: multiSource
        ? `${item.name} (${sourceNameById.get(item.fundingSourceId) ?? ""})`
        : item.name,
    }));

  const activeSources = sources.map((row) => row.label);
  // Null means never set, which is a different fact from a genuine zero (D-54), so it shows
  // as an empty field rather than a confident $0.00.
  const money = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));

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
      fundingSourceName: sourceNameById.get(item.fundingSourceId) ?? "",
      fundingSourceId: item.fundingSourceId,
      defaultDescription: item.defaultDescription ?? "",
      defaultNarrative: item.defaultNarrative ?? "",
      // A retired label is not offered again; the item falls back to the org default (R5.2).
      defaultPaymentSource:
        item.defaultPaymentSource && activeSources.includes(item.defaultPaymentSource)
          ? item.defaultPaymentSource
          : "",
      defaultTax: money(item.defaultTaxCents),
      defaultFees: money(item.defaultFeesCents),
      added: state.added,
    };
  });

  return (
    <div>
      <TourGuide tour="recurring" steps={RECURRING_TOUR_STEPS} alreadySeen={seenRecurringTour} />
      <PageTitle className="mb-2">Recurring Items</PageTitle>
      <Subtext className="mb-[26px] max-w-[70ch]">
        Vendors and salaries billed every month. Nothing is added automatically — confirm each
        one you want to add to {monthLabel(month)}.
      </Subtext>

      <RecurringManager
        rows={rows}
        lineItems={pickerLineItems}
        paymentSources={activeSources}
        month={month}
        monthLabel={monthLabel(month)}
        monthShort={monthShortLabel(month)}
        multiSource={multiSource}
        lockedMonths={[...lockedMonthKeys]}
      />
    </div>
  );
}
