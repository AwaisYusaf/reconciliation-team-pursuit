import { redirect } from "next/navigation";

import { PickFundingSource } from "@/src/components/app-shell/pick-funding-source";
import { PageTitle } from "@/src/components/ui/surfaces";
import { todayIso } from "@/src/domain/dates";
import { pageTitle, UI } from "@/src/domain/strings";
import { readAmountsAllowedForOrg } from "@/src/modules/ai/access";
import { loadInvoiceMatchContext } from "@/src/modules/expense-imports/match-context";
import { loadExpenseFormOptions } from "@/src/modules/expenses/queries";
import { loadSourceContext } from "@/src/modules/funding-sources/queries";
import { loadLockedMonths } from "@/src/modules/packet/queries";
import { getSession } from "@/src/services/auth/session";

import { InvoiceUploadScreen } from "./invoice-upload-screen";

export const metadata = { title: pageTitle(UI.invoiceUploadTitle) };

export default async function FromInvoicePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // Security: the entry point on Add Expense is gated on this same check (D-105); a page
  // reached directly must refuse itself rather than trust the link that pointed here.
  if (!(await readAmountsAllowedForOrg(session.orgId))) {
    redirect("/r/expenses/new");
  }

  const { selectedId, activeSources } = await loadSourceContext(
    session.orgId,
    session.activeFundingSourceId,
  );

  // Defensive fallback only — mirrors new/page.tsx, unreachable in practice.
  if (activeSources.length === 0) {
    return (
      <div>
        <PageTitle className="mb-2">{UI.invoiceUploadTitle}</PageTitle>
        <PickFundingSource sources={activeSources} />
      </div>
    );
  }

  const month = session.activeMonth;
  const [options, matchContext, lockedMonthKeys] = await Promise.all([
    loadExpenseFormOptions(session.orgId, null),
    loadInvoiceMatchContext(session.orgId),
    loadLockedMonths(session.orgId, null),
  ]);

  return (
    <div>
      <PageTitle className="mb-2">{UI.invoiceUploadTitle}</PageTitle>
      <InvoiceUploadScreen
        activeSources={activeSources.map((source) => ({ id: source.id, name: source.name }))}
        headerSelectedSourceId={selectedId}
        options={options}
        matchContext={matchContext}
        lockedMonths={[...lockedMonthKeys]}
        activeMonth={month}
        today={todayIso()}
      />
    </div>
  );
}
