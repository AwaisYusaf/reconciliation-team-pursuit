import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, PageTitle, SubsectionTitle } from "@/src/components/ui/surfaces";
import { TableCard, Td, Th } from "@/src/components/ui/table";
import { formatDateShort, formatDateTimeShort, monthLabel, todayIso } from "@/src/domain/dates";
import { formatBytes, ratio } from "@/src/domain/format";
import { PLAN_LABELS, UI } from "@/src/domain/strings";
import { describeAccountEvent, usersFooter } from "@/src/modules/admin/directory";
import { requireStaffPage } from "@/src/modules/admin/guard";
import {
  loadOrgAccount,
  loadOrgHistory,
  loadOrgUsage,
  loadOrgUsers,
  ORG_USERS_PREVIEW,
} from "@/src/modules/admin/queries";
import { userDisplay } from "@/src/domain/user-display";

import { AccountActions } from "./account-actions";
import { AccountBadges } from "../../badges";

/** Named per organization, so two open tabs are tellable apart. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const account = await loadOrgAccount((await params).id);
  return { title: account ? `${account.name} — AB Solutions admin` : "Organization — AB Solutions admin" };
}

/** One usage fact. `caption` is for the rare line that needs explaining, like what a packet
 *  download count actually counts. */
function UsageTile({
  label,
  caption,
  className,
  children,
}: {
  label: string;
  caption?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-[4px] border border-line bg-section/60 px-4 py-3.5 ${className ?? ""}`}>
      <dt className="text-[13px] text-sub leading-snug">{label}</dt>
      <dd className="mt-1.5">{children}</dd>
      {caption && <p className="text-[12px] text-muted mt-2 leading-snug">{caption}</p>}
    </div>
  );
}

/** A bare count, sized like the organizations list's tiles. */
function Figure({ children }: { children: React.ReactNode }) {
  return <span className="text-[26px] font-bold tabular-nums leading-none">{children}</span>;
}

/** A fact that is a sentence rather than a number ("3 active, 0 archived") — the wording is
 *  pinned in domain-rules §12, so it is shown whole rather than split into a big digit. */
function Sentence({ children }: { children: React.ReactNode }) {
  return <span className="text-[17px] font-semibold text-ink leading-snug">{children}</span>;
}

export default async function OrgPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireStaffPage();

  const { id } = await params;
  const account = await loadOrgAccount(id);
  if (!account) notFound();

  const query = await searchParams;
  // "View all" is a link rather than a button: the extra rows are fetched on the server when
  // asked for, so an organization with hundreds of users never ships them all by default.
  const showAllUsers = query.users === "all";
  // Where the reader came from — a filtered, paged list they should land back on. Only a
  // relative query string is honoured, so the link can't be turned into an off-site redirect.
  const rawBack = typeof query.back === "string" ? query.back : "";
  const backHref = rawBack.startsWith("?") ? `/a${rawBack}` : "/a";

  const [users, usage, history] = await Promise.all([
    loadOrgUsers(id, showAllUsers),
    loadOrgUsage(id),
    loadOrgHistory(id),
  ]);
  const footer = usersFooter({
    showAll: showAllUsers,
    shown: users.rows.length,
    total: users.total,
  });
  const today = todayIso();
  const storageRatio = ratio(usage.storageBytes, usage.storageLimitBytes);
  const storagePercent = Math.min(100, storageRatio * 100);
  const storageSentence = UI.usageStorage(
    formatBytes(usage.storageBytes),
    formatBytes(usage.storageLimitBytes),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={backHref} className="inline-flex items-center gap-1.5 text-[15px] text-sub hover:text-ink">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M10 3.5 5.5 8l4.5 4.5"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          All organizations
        </Link>
      </div>

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
        {users.rows.length === 0 ? (
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
              {users.rows.map((user) => (
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
        {footer === "view-all" && (
          <p className="text-[15px] text-sub mt-3">
            {UI.showingUsers(users.rows.length, users.total)}{" "}
            <Link
              href={`/a/orgs/${account.id}?users=all${rawBack ? `&back=${encodeURIComponent(rawBack)}` : ""}`}
              className="text-accent underline underline-offset-2 hover:no-underline"
            >
              View all
            </Link>
          </p>
        )}
        {footer === "capped" && (
          // Past the ceiling there is nothing further to show, so no link: the old code
          // rendered "View all" again, pointing at the page already open.
          <p className="text-[15px] text-sub mt-3">
            {UI.usersCapped(users.rows.length, users.total)}
          </p>
        )}
        {showAllUsers && users.total > ORG_USERS_PREVIEW && (
          <p className="text-[15px] text-sub mt-3">
            <Link
              href={`/a/orgs/${account.id}${rawBack ? `?back=${encodeURIComponent(rawBack)}` : ""}`}
              className="text-accent underline underline-offset-2 hover:no-underline"
            >
              Show fewer
            </Link>
          </p>
        )}
      </Card>

      <Card className="p-4 sm:p-5 lg:p-6">
        <SubsectionTitle className="mb-3">Usage</SubsectionTitle>
        {/* Tiles rather than a two-column list: the list left half the card empty and gave a
            one-digit count the same weight as a sentence. Same tile language as the
            organizations list, so the two screens read as one dashboard. */}
        <dl className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <UsageTile label="Funding sources">
            <Sentence>{UI.usageFundingSources(usage.fundingSourcesActive, usage.fundingSourcesArchived)}</Sentence>
          </UsageTile>
          <UsageTile label="Expenses">
            <Sentence>
              {UI.usageExpenses(usage.expensesTotal, usage.expensesCurrentMonth, monthLabel(usage.currentMonth))}
            </Sentence>
          </UsageTile>
          <UsageTile label="Last expense added">
            <Sentence>
              {usage.lastExpenseAt ? formatDateShort(todayIso(usage.lastExpenseAt)) : UI.noneYet}
            </Sentence>
          </UsageTile>
          <UsageTile label="Months submitted">
            <Figure>{usage.monthsSubmitted}</Figure>
          </UsageTile>
          <UsageTile label="Months locked">
            <Figure>{usage.monthsLocked}</Figure>
          </UsageTile>
          <UsageTile label={UI.packetsDownloadedLabel} caption={UI.packetsDownloadedNote}>
            <Figure>{usage.packetsDownloaded}</Figure>
          </UsageTile>
          <UsageTile label="Storage" className="col-span-2 lg:col-span-3">
            <Sentence>{storageSentence}</Sentence>
            <div
              role="img"
              aria-label={storageSentence}
              className="h-2 w-full max-w-[420px] rounded-full bg-line/50 overflow-hidden mt-2.5"
            >
              <div className="h-full bg-accent rounded-full" style={{ width: `${storagePercent}%` }} />
            </div>
          </UsageTile>
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

