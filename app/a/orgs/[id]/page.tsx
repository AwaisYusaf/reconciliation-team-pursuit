import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, PageTitle, SubsectionTitle } from "@/src/components/ui/surfaces";
import { TableCard, Td, Th } from "@/src/components/ui/table";
import { cn } from "@/src/lib/cn";
import { formatDateShort, formatDateTimeShort, monthLabel, todayIso } from "@/src/domain/dates";
import { formatBytes, formatMoney, ratio } from "@/src/domain/format";
import { PLAN_LABELS, UI } from "@/src/domain/strings";
import { aiCost } from "@/src/modules/admin/ai-cost";
import {
  describeAccountEvent,
  paymentStatusLabel,
  staffBilling,
  usersFooter,
  type StaffBillingTone,
} from "@/src/modules/admin/directory";
import { staffPayments } from "@/src/modules/billing/billing";
import { billingEnabled } from "@/src/modules/billing/config";
import { isLive } from "@/src/modules/billing/rules";
import { requireStaffPage } from "@/src/modules/admin/guard";
import {
  loadOrgAccount,
  loadOrgHistory,
  loadOrgAiUsage,
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
  return { title: account ? `${account.name} | AB Solutions admin` : "Organization | AB Solutions admin" };
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
    // A cell in a hairline grid, not a card of its own — see `FIGURE_GRID`. No border, no fill
    // and no radius here: the rules between cells come from the grid's gaps, so a cell that
    // drew its own would double every line.
    <div className={cn("bg-surface px-4 py-4 sm:px-5 sm:py-[18px]", className)}>
      <dt className="text-[11px] uppercase tracking-[0.08em] font-semibold text-sub leading-none">
        {label}
      </dt>
      <dd className="mt-2.5">{children}</dd>
      {caption && <p className="text-[12px] text-sub mt-2.5 leading-snug">{caption}</p>}
    </div>
  );
}

/**
 * The hairline grid the usage figures sit in.
 *
 * The rules are the grid's own 1px gaps with the line colour showing through from behind,
 * rather than a border on each cell. Borders between cells collapse into doubled 2px lines at
 * every seam and leave a stray edge wherever a row wraps; a gap cannot, at any column count.
 *
 * `overflow-hidden` is what rounds the block: the cells are square, and the corners are cut by
 * the container.
 */
const FIGURE_GRID =
  "grid grid-cols-2 lg:grid-cols-3 gap-px bg-line border border-line rounded-[10px] overflow-hidden";

/** Pill colours by how the billing is doing: paid, needs a look, failed, or just information. */
const TONE: Record<StaffBillingTone, string> = {
  good: "bg-emerald-50 text-emerald-800 border-emerald-200",
  warn: "bg-amber-50 text-amber-800 border-amber-200",
  bad: "bg-danger-bg text-danger border-danger/30",
  neutral: "bg-section text-sub border-line",
};

/** A bare count. Large and tight — on this screen the number is the content. */
function Figure({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[30px] font-bold tabular-nums leading-none text-ink">{children}</span>
  );
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

  const [users, usage, aiUsage, history, payments] = await Promise.all([
    loadOrgUsers(id, showAllUsers),
    loadOrgUsage(id),
    loadOrgAiUsage(id),
    loadOrgHistory(id),
    staffPayments(id),
  ]);
  const lastPaid = payments?.find((p) => p.status === "paid") ?? null;
  const billing = staffBilling(account, lastPaid);
  const footer = usersFooter({
    showAll: showAllUsers,
    shown: users.rows.length,
    total: users.total,
  });
  const today = todayIso();
  // Same test the server applies in `changePlanAction` (P16), so the button never offers what
  // the action would refuse.
  const stripeManaged = billingEnabled() && isLive(account.stripeStatus);
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
        <PageTitle gradient className="mb-4">{account.name}</PageTitle>
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

        <SubsectionTitle gradient className="mb-2">Users</SubsectionTitle>
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
        <SubsectionTitle gradient className="mb-3">Usage</SubsectionTitle>
        {/* Tiles rather than a two-column list: the list left half the card empty and gave a
            one-digit count the same weight as a sentence. Same tile language as the
            organizations list, so the two screens read as one dashboard. */}
        <dl className={FIGURE_GRID}>
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
              className="h-2.5 w-full max-w-[420px] rounded-full bg-line/50 overflow-hidden mt-2.5"
            >
              {/* The bar takes the app's brown ramp rather than a flat `accent`, so it matches
                  the primary button and the settings sidebar's selected row. */}
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-accent)_0%,var(--color-accent-dark)_100%)]"
                style={{ width: `${storagePercent}%` }}
              />
            </div>
          </UsageTile>
        </dl>
      </Card>

      <Card className="p-4 sm:p-5 lg:p-6">
        <SubsectionTitle gradient className="mb-3">AI usage</SubsectionTitle>
        {/* Every OpenAI call this organization has made (ai_usage_events, D-106/D-107). Each
            feature is counted apart because they cost wildly different amounts: a summary is
            roughly a hundred times a receipt read, and an invoice read is a whole multi-page
            bill rather than one receipt. Every feature needs its own tile, or its runs are
            invisible here while its cost still lands in the total below. */}
        <dl className={FIGURE_GRID}>
          {/* The big number is all time; the caption says how many of those were this month. The
              two used to be shown as "4 / 4", which read like a fraction. */}
          <UsageTile
            label="Receipt reads"
            caption={UI.aiUsageInMonth(aiUsage.reads.currentMonth, monthLabel(aiUsage.currentMonth))}
          >
            <Figure>{aiUsage.reads.total}</Figure>
          </UsageTile>
          <UsageTile
            label="Monthly summaries"
            caption={UI.aiUsageInMonth(aiUsage.summaries.currentMonth, monthLabel(aiUsage.currentMonth))}
          >
            <Figure>{aiUsage.summaries.total}</Figure>
          </UsageTile>
          <UsageTile
            label="Invoice reads"
            caption={UI.aiUsageInMonth(aiUsage.invoiceReads.currentMonth, monthLabel(aiUsage.currentMonth))}
          >
            <Figure>{aiUsage.invoiceReads.total}</Figure>
          </UsageTile>
          <UsageTile label="Runs with nothing saved" caption={UI.aiUsageUnsavedNote}>
            <Figure>
              {aiUsage.reads.unsaved + aiUsage.summaries.unsaved + aiUsage.invoiceReads.unsaved}
            </Figure>
          </UsageTile>
          {/* One cost tile: the figure is all time, the caption carries this month and, when some
              runs were logged before the price settings existed, that the figure is a floor. */}
          <UsageTile
            label="Cost all time"
            caption={
              `${aiCost(aiUsage.costMicroUsdCurrentMonth)} in ${monthLabel(aiUsage.currentMonth)}` +
              (aiUsage.costIncomplete ? ` · ${UI.aiUsageCostIncomplete}` : "")
            }
          >
            <Sentence>{aiCost(aiUsage.costMicroUsdTotal)}</Sentence>
          </UsageTile>
          <UsageTile label="Last run">
            <Sentence>{aiUsage.lastRunAt ? formatDateShort(todayIso(aiUsage.lastRunAt)) : UI.noneYet}</Sentence>
          </UsageTile>
        </dl>
      </Card>

      {billing && (
        <Card className="p-4 sm:p-5 lg:p-6">
          {/* Has this org paid? Answered first, as a pill and one line; the facts and the
              invoices follow. */}
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <SubsectionTitle gradient className="mb-2">{UI.staffBillingTitle}</SubsectionTitle>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className={cn("inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold border", TONE[billing.headline.tone])}>
                  <span className="w-2 h-2 rounded-full bg-current" aria-hidden="true" />
                  {billing.headline.label}
                </span>
                {billing.headline.detail && <span className="text-[15px] text-sub">{billing.headline.detail}</span>}
              </div>
            </div>
            {billing.customerUrl && (
              <a
                href={billing.customerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center min-h-11 px-4 rounded-[3px] border border-line text-[15px] text-accent hover:bg-section"
              >
                {UI.staffBillingOpenCustomer}
              </a>
            )}
          </div>

          {billing.warnings.map((warning) => (
            <p key={warning} className="text-[15px] font-semibold text-danger mb-3" role="status">
              {warning}
            </p>
          ))}

          {billing.facts.length > 0 && (
            <dl className={cn(FIGURE_GRID, "mb-5")}>
              {billing.facts.map((fact) => (
                <UsageTile key={fact.label} label={fact.label}>
                  <Sentence>{fact.value}</Sentence>
                </UsageTile>
              ))}
            </dl>
          )}

          <h3 className="text-[13px] uppercase tracking-[0.08em] font-semibold text-muted mb-2">{UI.staffPaymentsTitle}</h3>
          {payments === null ? (
            <p className="text-[15px] text-sub">{UI.staffPaymentsUnavailable}</p>
          ) : payments.length === 0 ? (
            <p className="text-[15px] text-sub">{UI.staffPaymentsNone}</p>
          ) : (
            <TableCard minWidth={480}>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Amount</Th>
                  <Th>Status</Th>
                  <Th>
                    <span className="sr-only">Invoice</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <Td>{formatDateShort(todayIso(payment.at))}</Td>
                    <Td className="tabular-nums">{formatMoney(payment.amountCents)}</Td>
                    <Td>
                      <span
                        className={cn(
                          "inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold border",
                          TONE[payment.status === "paid" ? "good" : payment.status === "open" ? "warn" : "neutral"],
                        )}
                      >
                        {paymentStatusLabel(payment.status)}
                      </span>
                    </Td>
                    <Td>
                      {payment.url && (
                        <a
                          href={payment.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent underline underline-offset-2 hover:no-underline"
                        >
                          {UI.staffPaymentsView}
                        </a>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableCard>
          )}
        </Card>
      )}

      <Card className="p-4 sm:p-5 lg:p-6">
        <SubsectionTitle gradient className="mb-3">Actions</SubsectionTitle>
        <AccountActions org={account} stripeManaged={stripeManaged} customerUrl={billing?.customerUrl ?? null} />
      </Card>

      <Card className="p-4 sm:p-5 lg:p-6">
        <SubsectionTitle gradient className="mb-2">History</SubsectionTitle>
        <ul className="divide-y divide-line">
          {history.map((event) => (
            <li key={event.id} className="py-2.5 text-[15px]">
              {formatDateTimeShort(event.createdAt)} · {describeAccountEvent(event)}
              {event.note !== null && ` · ${event.note}`}
            </li>
          ))}
          <li className="py-2.5 text-[15px]">
            {formatDateShort(todayIso(account.createdAt))} · {UI.orgSignedUp}
          </li>
        </ul>
      </Card>
    </div>
  );
}

