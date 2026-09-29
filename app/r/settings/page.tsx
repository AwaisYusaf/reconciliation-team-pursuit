import { PageTitle } from "@/src/components/ui/surfaces";
import { TourGuide } from "@/src/components/ui/tour";
import { db } from "@/src/db";
import { formatMoneyInput } from "@/src/domain/format";
import { fundingTotalCents } from "@/src/domain/funding-limit";
import { pageTitle } from "@/src/domain/strings";
import { aiAllowedForOrg } from "@/src/modules/ai/access";
import { billingEnabled } from "@/src/modules/billing/config";
import { loadPlanBilling } from "@/src/modules/billing/plan-view-loader";
import { loadFundingSourceLimit } from "@/src/modules/funding-sources/limit";
import { loadFundingPosition } from "@/src/modules/funding-sources/queries";
import { loadSettings } from "@/src/modules/settings/queries";
import { parseSettingsSection } from "@/src/modules/settings/sections";
import { pageSession } from "@/src/lib/page-session";
import { listOrgUsersAction } from "@/src/modules/users/actions";
import { SETTINGS_TOUR_STEPS } from "@/src/modules/tours/settings-tour";
import { hasSeenTour } from "@/src/modules/tours/queries";
import type { OrgUser } from "./users/users-manager";

import { avatarVersionOf } from "@/src/services/storage/keys";
import { SettingsSections } from "./settings-sections";

export const metadata = { title: pageTitle("Settings") };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string | string[] }>;
}) {
  const session = await pageSession();

  const isAdmin = session.role === "admin";
  // `?section=plan` from the Plus pill and billing banners (Phase 16 P19); unknown → Organization.
  // Plan & billing exists only once billing is on: until then there is nothing to show there.
  const billingOn = billingEnabled();
  const section = parseSettingsSection((await searchParams).section, isAdmin, billingOn);

  // The organisation always comes from the session, never from the request.
  const data = await loadSettings(session.orgId);

  // The action itself re-checks the role — this is only what decides whether the Users tab
  // has anything to show, not the security boundary. Skipped entirely for a manager, so
  // there's never a moment where their RSC payload could carry another user's data.
  const [usersResult, seenSettingsTour, planBilling, aiAllowed, fundingSourceLimit] = await Promise.all([
    isAdmin ? listOrgUsersAction() : Promise.resolve(null),
    hasSeenTour(session.userId, "settings"),
    billingOn ? loadPlanBilling(session) : Promise.resolve(null),
    aiAllowedForOrg(session.orgId),
    loadFundingSourceLimit(session.orgId),
  ]);
  const users: OrgUser[] = usersResult?.ok ? usersResult.data : [];
  const usersError = usersResult && !usersResult.ok ? usersResult.error : undefined;

  // Each source's line items against its contract total, for the funding card (R9.6).
  const positions = await Promise.all(
    data.fundingSources.map((source) => loadFundingPosition(db, session.orgId, source.id)),
  );

  return (
    <div>
      <TourGuide tour="settings" steps={SETTINGS_TOUR_STEPS} alreadySeen={seenSettingsTour} />
      <PageTitle className="mb-6">Settings</PageTitle>

      {/* Keyed by section so a link to another section (the Plus pill, a banner) opens it even
          when Settings is already on screen; the sidebar's own clicks stay client-side. */}
      <SettingsSections
        key={section}
        initialSection={section}
        planBilling={planBilling}
        email={session.email}
        userName={session.userName ?? null}
        avatarVersion={session.avatarKey ? avatarVersionOf(session.avatarKey) : null}
        organisation={{ name: data.org.name, docName: data.org.docName }}
        fundingSources={data.fundingSources.map((source, i) => ({
          id: source.id,
          name: source.name,
          type: source.type,
          docName: source.docName ?? "",
          projectName: source.projectName,
          contractNumber: source.contractNumber,
          basePoNumber: source.basePoNumber,
          performancePoNumber: source.performancePoNumber,
          contractValue: formatMoneyInput(source.contractValueCents),
          contractStart: source.contractStart ?? "",
          contractEnd: source.contractEnd ?? "",
          fiduciaryName: source.fiduciaryName,
          advancesReceived: formatMoneyInput(source.advancesReceivedCents),
          taxReimbursable: source.taxReimbursable,
          feesReimbursable: source.feesReimbursable,
          archived: source.archivedAt !== null,
          newPerformanceCents: positions[i]?.newPerformanceCents ?? 0,
          contractTotalCents: positions[i] ? fundingTotalCents(positions[i]) : 0,
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
        fundingSourceLimit={fundingSourceLimit}
        // Paid and on Reconciliation + AI (Phase 16 §4.2), not the plan label alone.
        readAmounts={aiAllowed ? { enabled: data.readAmountsEnabled } : null}
      />
    </div>
  );
}
