import "server-only";

/**
 * The month facts loader (Phase 11, D-107, P2).
 *
 * One repeatable-read, read-only transaction — same shape as `loadMonthSnapshot`
 * (`src/generation/month-snapshot.ts:312`) — so the facts and the fingerprint describe the same
 * instant. Reuses the Dashboard/Contract Summary loaders (`loadLineItemBudgets`,
 * `loadExpenseAmounts`, `loadFundingSourceSettings`) rather than querying budget figures again.
 */
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/src/db";
import { loadExpenseAmounts, loadFundingSourceSettings, loadLineItemBudgets } from "@/src/db/queries";
import { expenses, fundingSources, monthlySummaries, organizations, users } from "@/src/db/schema";
import { isValidMonthKey, type MonthKey } from "@/src/domain/dates";
import { buildMonthFacts, type MonthFacts, type SummaryExpense } from "@/src/domain/monthly-summary-facts";
import { userDisplay } from "@/src/domain/user-display";
import { isUuid } from "@/src/lib/ids";
import { summariesAccessForOrg } from "@/src/modules/ai/access";
import { findFundingSource } from "@/src/modules/funding-sources/queries";

import { expensesFingerprint } from "./fingerprint";
import { isSummaryWriting } from "./single-flight";

/**
 * The facts for one funding source's month, and the fingerprint of the expenses they were built
 * from. Returns `null` for an invalid month key, a non-uuid source id, or a source not owned by
 * this organisation — every case the caller should treat as "not found", not throw.
 */
export async function loadMonthFacts(
  orgId: string,
  sourceId: string,
  month: MonthKey,
): Promise<{ facts: MonthFacts; fingerprint: string } | null> {
  if (!isValidMonthKey(month)) return null;
  if (!isUuid(sourceId)) return null;

  return db.transaction(
    async (tx) => {
      const [source] = await tx
        .select({ name: fundingSources.name, docName: fundingSources.docName })
        .from(fundingSources)
        .where(and(eq(fundingSources.id, sourceId), eq(fundingSources.orgId, orgId)))
        .limit(1);
      if (!source) return null;

      const [org] = await tx
        .select({ docName: organizations.docName })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      if (!org) return null;

      const monthExpenses: SummaryExpense[] = await tx
        .select({
          id: expenses.id,
          lineItemId: expenses.lineItemId,
          name: expenses.name,
          description: expenses.description,
          narrative: expenses.narrative,
          note: expenses.note,
          date: expenses.date,
          subtotalCents: expenses.subtotalCents,
          taxCents: expenses.taxCents,
          feesCents: expenses.feesCents,
          taxReimbursable: expenses.taxReimbursable,
          feesReimbursable: expenses.feesReimbursable,
          noReceipt: expenses.noReceipt,
          noReceiptReason: expenses.noReceiptReason,
        })
        .from(expenses)
        .where(
          and(
            eq(expenses.orgId, orgId),
            eq(expenses.fundingSourceId, sourceId),
            eq(expenses.month, month),
            isNull(expenses.deletedAt),
          ),
        )
        .orderBy(asc(expenses.sortOrder), asc(expenses.id));

      // Sequential, like `loadMonthSnapshot`: one transaction's client processes one query at a
      // time anyway, and this keeps every read in this transaction in a fixed, reviewable order.
      const lineItems = await loadLineItemBudgets(orgId, sourceId, tx);
      const expensesUpToMonth = await loadExpenseAmounts(orgId, sourceId, month, tx);
      const settings = await loadFundingSourceSettings(orgId, sourceId, tx);

      const facts = buildMonthFacts({
        orgDocName: org.docName,
        source,
        month,
        lineItems,
        expensesUpToMonth,
        monthExpenses,
        settings,
      });

      return { facts, fingerprint: expensesFingerprint(monthExpenses) };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export type MonthlySummaryScreen = {
  access: { use: boolean; write: boolean };
  summary: {
    contentMarkdown: string;
    version: number;
    writtenAt: Date;
    writtenByName: string | null;
    editedAt: Date | null;
    editedByName: string | null;
    model: string;
  } | null;
  /** P7: the stored fingerprint no longer matches the month's live expenses. */
  stale: boolean;
  liveExpenseCount: number;
  savedMonths: Array<{ month: MonthKey; writtenAt: Date; editedAt: Date | null }>;
  /** P11: a run for this org/source/month is in flight right now, in this container — read
   *  from the single-flight set with the DB-resolved `source.id`, not the caller's raw id.
   *  Always false on the base plan (P15: nothing here to be writing). */
  writing: boolean;
};

const writers = alias(users, "monthly_summary_writers");
const editors = alias(users, "monthly_summary_editors");

/**
 * Everything the Monthly summary screen needs for one funding source's month (Phase 11 §6).
 * `null` for an invalid month key or a source not owned by this organisation — the caller's
 * "not found", same as every other entry point here.
 *
 * Takes `orgId` directly rather than a session, and is not `"use server"`: unlike the actions
 * beside it, this is read by a Server Component with the session already resolved, and must
 * not itself become a directly invocable endpoint.
 */
export async function loadMonthlySummaryScreen(
  orgId: string,
  sourceId: string,
  month: MonthKey,
): Promise<MonthlySummaryScreen | null> {
  if (!isValidMonthKey(month)) return null;

  const source = await findFundingSource(orgId, sourceId);
  if (!source) return null;

  const access = await summariesAccessForOrg(orgId);

  // Base plan (P15): the note only. Data is kept and reappears on upgrade, but nothing is
  // loaded for a plan that can't see it.
  if (!access.use) {
    return { access, summary: null, stale: false, liveExpenseCount: 0, savedMonths: [], writing: false };
  }

  const [row] = await db
    .select({
      contentMarkdown: monthlySummaries.contentMarkdown,
      version: monthlySummaries.version,
      writtenAt: monthlySummaries.writtenAt,
      writerName: writers.name,
      writerEmail: writers.email,
      editedAt: monthlySummaries.editedAt,
      editorName: editors.name,
      editorEmail: editors.email,
      model: monthlySummaries.model,
      expensesFingerprint: monthlySummaries.expensesFingerprint,
    })
    .from(monthlySummaries)
    .leftJoin(writers, eq(writers.id, monthlySummaries.writtenBy))
    .leftJoin(editors, eq(editors.id, monthlySummaries.editedBy))
    .where(
      and(
        eq(monthlySummaries.orgId, orgId),
        eq(monthlySummaries.fundingSourceId, sourceId),
        eq(monthlySummaries.month, month),
      ),
    )
    .limit(1);

  // `source` above already confirms `sourceId` is a valid, owned funding source and `month` is
  // already validated, so `loadMonthFacts` cannot return null here.
  const loaded = await loadMonthFacts(orgId, sourceId, month);
  const liveExpenseCount = loaded?.facts.overview.expenseCount ?? 0;

  const summary = row
    ? {
        contentMarkdown: row.contentMarkdown,
        version: row.version,
        writtenAt: row.writtenAt,
        writtenByName: row.writerEmail === null ? null : userDisplay(row.writerName, row.writerEmail),
        editedAt: row.editedAt,
        editedByName: row.editorEmail === null ? null : userDisplay(row.editorName, row.editorEmail),
        model: row.model,
      }
    : null;

  const stale = row !== undefined && loaded !== null && row.expensesFingerprint !== loaded.fingerprint;

  const savedMonths = await db
    .select({
      month: monthlySummaries.month,
      writtenAt: monthlySummaries.writtenAt,
      editedAt: monthlySummaries.editedAt,
    })
    .from(monthlySummaries)
    .where(and(eq(monthlySummaries.orgId, orgId), eq(monthlySummaries.fundingSourceId, sourceId)))
    .orderBy(desc(monthlySummaries.month));

  return {
    access,
    summary,
    stale,
    liveExpenseCount,
    savedMonths,
    writing: isSummaryWriting(orgId, source.id, month),
  };
}

/**
 * The packet card's needs (§7): whether the plan can see summaries at all, and when the
 * current month's summary was written — cheap, one `select` beyond the access check. `null`
 * for an invalid month key or a source not owned by this organisation, same "not found"
 * convention as every other entry point here.
 */
export async function loadSummaryCard(
  orgId: string,
  sourceId: string,
  month: MonthKey,
): Promise<{ use: boolean; writtenAt: Date | null } | null> {
  if (!isValidMonthKey(month)) return null;

  const source = await findFundingSource(orgId, sourceId);
  if (!source) return null;

  const access = await summariesAccessForOrg(orgId);
  if (!access.use) return { use: false, writtenAt: null };

  const [row] = await db
    .select({ writtenAt: monthlySummaries.writtenAt })
    .from(monthlySummaries)
    .where(
      and(
        eq(monthlySummaries.orgId, orgId),
        eq(monthlySummaries.fundingSourceId, sourceId),
        eq(monthlySummaries.month, month),
      ),
    )
    .limit(1);

  return { use: true, writtenAt: row?.writtenAt ?? null };
}

/** The viewer's display name for the meta line (§6) — `userDisplay` needs the user's own
 *  name/email, which the session doesn't carry (only `email`). Missing user (deleted mid
 *  session) falls back to the session's email, same as `userDisplay` would once trimmed. */
export async function loadViewerDisplay(userId: string, fallbackEmail: string): Promise<string> {
  const [row] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return fallbackEmail;
  return userDisplay(row.name, row.email);
}
