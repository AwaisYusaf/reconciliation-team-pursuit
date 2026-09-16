import { notFound } from "next/navigation";

import { Card, PageTitle, SubsectionTitle } from "@/src/components/ui/surfaces";
import { TableCard, Td, Th } from "@/src/components/ui/table";
import { formatDateShort, formatDateTimeShort, monthLabel, todayIso } from "@/src/domain/dates";
import { formatBytes, ratio } from "@/src/domain/format";
import { PLAN_LABELS, UI } from "@/src/domain/strings";
import { describeAccountEvent } from "@/src/modules/admin/directory";
import { requireStaffPage } from "@/src/modules/admin/guard";
import { loadOrgAccount, loadOrgHistory, loadOrgUsage, loadOrgUsers } from "@/src/modules/admin/queries";
import { userDisplay } from "@/src/domain/user-display";

import { AccountActions } from "./account-actions";
import { AccountBadges } from "../../badges";

export const metadata = { title: "Organization — AB Solutions admin" };

export default async function OrgPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaffPage();

  const { id } = await params;
  const account = await loadOrgAccount(id);
  if (!account) notFound();

  const [users, usage, history] = await Promise.all([
    loadOrgUsers(id),
    loadOrgUsage(id),
    loadOrgHistory(id),
  ]);
  const today = todayIso();
  const storageRatio = ratio(usage.storageBytes, usage.storageLimitBytes);
  const storagePercent = Math.min(100, storageRatio * 100);
  const storageSentence = UI.usageStorage(
    formatBytes(usage.storageBytes),
    formatBytes(usage.storageLimitBytes),
  );

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-4 sm:p-5 lg:p-6">
        <PageTitle className="mb-4">{account.name}</PageTitle>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 mb-5">
          <div>
            <dt className="text-[13px] text-sub">Name printed on documents</dt>
            <dd className="text-[15px] text-ink font-medium">{account.docName}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-sub">Signed up</dt>
            <dd className="text-[15px] text-ink font-medium">{formatDateShort(todayIso(account.createdAt))}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-sub">Setup finished</dt>
            <dd className="text-[15px] text-ink font-medium">
              {account.onboardedAt ? formatDateShort(todayIso(account.onboardedAt)) : UI.setupNotFinished}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-sub">Plan &amp; status</dt>
            <dd className="text-[15px] text-ink font-medium flex flex-wrap items-center gap-2">
              {PLAN_LABELS[account.plan]}
              <AccountBadges org={account} today={today} />
            </dd>
          </div>
        </dl>

        <SubsectionTitle className="mb-2">Users</SubsectionTitle>
        {users.length === 0 ? (
          <p className="text-[15px] text-sub">{UI.noUsersYet}</p>
        ) : (
          <TableCard minWidth={640}>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Last sign-in</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <Td>{userDisplay(user.name, user.email)}</Td>
                  <Td>{user.email}</Td>
                  <Td>{user.role === "admin" ? "Admin" : "Manager"}</Td>
                  <Td>{user.lastSignInAt ? formatDateShort(todayIso(user.lastSignInAt)) : UI.notRecordedYet}</Td>
                </tr>
              ))}
            </tbody>
          </TableCard>
        )}
      </Card>

      <Card className="p-4 sm:p-5 lg:p-6">
        <SubsectionTitle className="mb-3">Usage</SubsectionTitle>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          <div>
            <dt className="text-[13px] text-sub">Funding sources</dt>
            <dd className="text-[15px] text-ink font-medium">
              {UI.usageFundingSources(usage.fundingSourcesActive, usage.fundingSourcesArchived)}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-sub">Expenses</dt>
            <dd className="text-[15px] text-ink font-medium">
              {UI.usageExpenses(usage.expensesTotal, usage.expensesCurrentMonth, monthLabel(usage.currentMonth))}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-sub">Last expense added</dt>
            <dd className="text-[15px] text-ink font-medium">
              {usage.lastExpenseAt ? formatDateShort(todayIso(usage.lastExpenseAt)) : UI.noneYet}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-sub">Months submitted · locked</dt>
            <dd className="text-[15px] text-ink font-medium">
              {usage.monthsSubmitted} · {usage.monthsLocked}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[13px] text-sub">Storage</dt>
            <dd className="text-[15px] text-ink font-medium mb-1.5">{storageSentence}</dd>
            <div
              role="img"
              aria-label={storageSentence}
              className="h-2 w-full max-w-[320px] rounded-full bg-section overflow-hidden"
            >
              <div className="h-full bg-accent rounded-full" style={{ width: `${storagePercent}%` }} />
            </div>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[13px] text-sub">{UI.packetsDownloadedLabel}</dt>
            <dd className="text-[15px] text-ink font-medium">{usage.packetsDownloaded}</dd>
            <p className="text-sm text-sub mt-1">{UI.packetsDownloadedNote}</p>
          </div>
        </dl>
      </Card>

      <Card className="p-4 sm:p-5 lg:p-6">
        <SubsectionTitle className="mb-3">Actions</SubsectionTitle>
        <AccountActions org={account} />
      </Card>

      <Card className="p-4 sm:p-5 lg:p-6">
        <SubsectionTitle className="mb-2">History</SubsectionTitle>
        <ul className="divide-y divide-line">
          {history.map((event) => (
            <li key={event.id} className="py-2.5 text-[15px]">
              {formatDateTimeShort(event.createdAt)} – {describeAccountEvent(event)}
              {event.note !== null && ` – ${event.note}`}
            </li>
          ))}
          <li className="py-2.5 text-[15px]">
            {formatDateShort(todayIso(account.createdAt))} – {UI.orgSignedUp}
          </li>
        </ul>
      </Card>
    </div>
  );
}

