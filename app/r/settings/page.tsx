import { redirect } from "next/navigation";

import { PageTitle } from "@/src/components/ui/surfaces";
import { TourGuide } from "@/src/components/ui/tour";
import { loadSettings } from "@/src/modules/settings/queries";
import { getSession } from "@/src/services/auth/session";
import { listOrgUsersAction } from "@/src/modules/users/actions";
import { SETTINGS_TOUR_STEPS } from "@/src/modules/tours/settings-tour";
import { hasSeenTour } from "@/src/modules/tours/queries";
import type { OrgUser } from "./users/users-manager";

import { SettingsSections } from "./settings-sections";

export const metadata = { title: "Settings — Grant Expense Reconciliation" };

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const isAdmin = session.role === "admin";

  // The organisation always comes from the session, never from the request.
  const data = await loadSettings(session.orgId);

  // The action itself re-checks the role — this is only what decides whether the Users tab
  // has anything to show, not the security boundary. Skipped entirely for a manager, so
  // there's never a moment where their RSC payload could carry another user's data.
  const [usersResult, seenSettingsTour] = await Promise.all([
    isAdmin ? listOrgUsersAction() : Promise.resolve(null),
    hasSeenTour(session.userId, "settings"),
  ]);
  const users: OrgUser[] = usersResult?.ok ? usersResult.data : [];
  const usersError = usersResult && !usersResult.ok ? usersResult.error : undefined;

  const money = (cents: number) => (cents / 100).toFixed(2);

  return (
    <div>
      <TourGuide tour="settings" steps={SETTINGS_TOUR_STEPS} alreadySeen={seenSettingsTour} />
      <PageTitle className="mb-6">Settings</PageTitle>

      <SettingsSections
        email={session.email}
        organisation={{ name: data.org.name, docName: data.org.docName }}
        fundingSources={data.fundingSources.map((source) => ({
          id: source.id,
          name: source.name,
          type: source.type,
          docName: source.docName ?? "",
          projectName: source.projectName,
          contractNumber: source.contractNumber,
          basePoNumber: source.basePoNumber,
          performancePoNumber: source.performancePoNumber,
          contractValue: money(source.contractValueCents),
          contractStart: source.contractStart ?? "",
          contractEnd: source.contractEnd ?? "",
          fiduciaryName: source.fiduciaryName,
          advancesReceived: money(source.advancesReceivedCents),
          taxReimbursable: source.taxReimbursable,
          feesReimbursable: source.feesReimbursable,
          archived: source.archivedAt !== null,
        }))}
        paymentSources={data.sources.map((row) => ({
          id: row.id,
          label: row.label,
          active: row.active,
        }))}
        supportingDocTypes={data.docTypes.map((row) => ({
          id: row.id,
          label: row.label,
          active: row.active,
        }))}
        vendors={data.vendors}
        vendorCount={data.vendorCount}
        lineItems={data.lineItems}
        isAdmin={isAdmin}
        users={users}
        usersError={usersError}
      />
    </div>
  );
}
