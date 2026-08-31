import { redirect } from "next/navigation";

import { PageTitle } from "@/src/components/ui/surfaces";
import { loadSettings } from "@/src/modules/settings/queries";
import { getSession } from "@/src/services/auth/session";

import { SettingsSections } from "./settings-sections";

export const metadata = { title: "Settings — Grant Expense Reconciliation" };

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // The organisation always comes from the session, never from the request.
  const data = await loadSettings(session.orgId);

  const money = (cents: number) => (cents / 100).toFixed(2);

  return (
    <div>
      <PageTitle className="mb-6">Settings</PageTitle>

      <SettingsSections
        email={session.email}
        organisation={{ name: data.org.name, docName: data.org.docName }}
        contract={{
          projectName: data.settings?.projectName ?? "",
          contractNumber: data.settings?.contractNumber ?? "",
          basePoNumber: data.settings?.basePoNumber ?? "",
          performancePoNumber: data.settings?.performancePoNumber ?? "",
          contractValue: money(data.settings?.contractValueCents ?? 0),
          contractStart: data.settings?.contractStart ?? "",
          contractEnd: data.settings?.contractEnd ?? "",
          fiduciaryName: data.settings?.fiduciaryName ?? "",
        }}
        grant={{
          perfGrantScheduled: money(data.settings?.perfGrantScheduledCents ?? 0),
          perfGrantBilled: money(data.settings?.perfGrantBilledCents ?? 0),
          advancesReceived: money(data.settings?.advancesReceivedCents ?? 0),
        }}
        paymentSources={data.sources.map((row) => ({
          id: row.id,
          label: row.label,
          active: row.active,
          taxReimbursable: row.taxReimbursable,
          feesReimbursable: row.feesReimbursable,
        }))}
        supportingDocTypes={data.docTypes.map((row) => ({
          id: row.id,
          label: row.label,
          active: row.active,
        }))}
        vendors={data.vendors}
        vendorCount={data.vendorCount}
        lineItems={data.lineItems}
      />
    </div>
  );
}
