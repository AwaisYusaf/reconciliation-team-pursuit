import { redirect } from "next/navigation";

import { PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { formatDateUS, monthLabel, todayIso } from "@/src/domain/dates";
import { pageTitle } from "@/src/domain/strings";
import { loadTrashedExpenses } from "@/src/modules/expenses/queries";
import { findFundingSource, loadSourceContext } from "@/src/modules/funding-sources/queries";
import { loadLockedMonths } from "@/src/modules/packet/queries";
import { getSession } from "@/src/services/auth/session";

import { TrashTable, type TrashRow } from "./trash-table";

export const metadata = { title: pageTitle("Trash") };

export default async function ExpenseTrashPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { source: requestedSource } = await searchParams;

  const { sources, selectedId } = await loadSourceContext(
    session.orgId,
    session.activeFundingSourceId,
  );
  const multiSource = sources.length > 1;

  // Same resolution as the Expenses list: the header already scopes a chosen source; with
  // "All" active, an explicit `?source=` narrows it, validated server-side.
  const scope =
    selectedId !== null
      ? selectedId
      : requestedSource
        ? (await findFundingSource(session.orgId, requestedSource))?.id ?? null
        : null;

  const sourceNameById = new Map(sources.map((source) => [source.id, source.name]));

  const [expenses, lockedMonthKeys] = await Promise.all([
    loadTrashedExpenses(session.orgId, scope),
    loadLockedMonths(session.orgId, null),
  ]);
  const presentSourceIds = new Set(expenses.map((expense) => expense.fundingSourceId));
  const fundingSources = sources
    .filter((source) => source.archivedAt === null || presentSourceIds.has(source.id))
    .map((source) => ({ id: source.id, name: source.name }));

  const rows: TrashRow[] = expenses.map((expense) => ({
    id: expense.id,
    name: expense.name,
    lineItemName: expense.lineItemName,
    fundingSourceName: sourceNameById.get(expense.fundingSourceId) ?? "",
    fundingSourceId: expense.fundingSourceId,
    month: monthLabel(expense.month),
    monthKey: expense.month,
    amountCents: expense.amountCents,
    deletedAt: formatDateUS(todayIso(expense.deletedAt)),
    // Only "attached" documents — a pending or failed upload has no bytes to preview, which
    // is also what the active expenses list means by this.
    documents: expense.documents
      .filter((document) => document.status === "attached")
      .map(({ id, filename, mimeType }) => ({ id, filename, mimeType })),
  }));

  return (
    <div>
      <PageTitle className="mb-1.5">Trash</PageTitle>
      <Subtext className="mb-6">
        Deleted expenses, across every month. Restore one, or delete it for good.
      </Subtext>

      <TrashTable
        rows={rows}
        multiSource={multiSource}
        fundingSources={fundingSources}
        selectedSourceId={scope}
        sourceFilterOffered={selectedId === null}
        lockedMonths={[...lockedMonthKeys]}
      />
    </div>
  );
}
