"use server";

/**
 * Writing and saving monthly summaries (Phase 11 §6, D-107, P4, P10, P11, P12).
 *
 * Every entry: shape-checks its (directly invocable) input, `actionSession()` (admins and
 * managers, not `requireAdmin()`), `requireOwnedFundingSource`, `isValidMonthKey`, and the P1
 * access split read fresh from the database — never throws to the caller. Nothing but
 * `sourceId`/`month` from the client ever reaches `writeSummary`.
 */
import { and, eq, sql } from "drizzle-orm";

import { db, type Database } from "@/src/db";
import { aiUsageEvents, monthlySummaries, type SummaryTrigger } from "@/src/db/schema";
import { isValidMonthKey, monthLabel, type MonthKey } from "@/src/domain/dates";
import type { MonthFacts } from "@/src/domain/monthly-summary-facts";
import { UI } from "@/src/domain/strings";
import { checkSummaryStructure, SUMMARY_MAX_CHARS } from "@/src/domain/summary-markdown";
import { unsuppliedFigures } from "@/src/domain/summary-verifier";
import { fail, ok, type ActionResult } from "@/src/lib/action-result";
import { actionSession } from "@/src/lib/action-session";
import { summariesAccessForOrg } from "@/src/modules/ai/access";
import { requireOwnedFundingSource } from "@/src/modules/funding-sources/queries";
import { loadMonthFacts } from "@/src/modules/monthly-summary/queries";
import {
  beginSummaryWrite,
  endSummaryWrite,
  isSummaryWriting,
  summaryWriteKey,
} from "@/src/modules/monthly-summary/single-flight";
import { costMicroUsd } from "@/src/services/openai/responses";
import { retryFeedbackFor, writeSummary } from "@/src/services/openai/write-summary";
import { consume } from "@/src/services/rate-limit";

/** Reused for a client input whose shape or ids don't even parse — same wording
 *  `requireOwnedFundingSource` already uses for "not found". */
const GENERIC_REFUSAL = "Choose a funding source.";

type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export type WriteSummaryActionData = {
  contentMarkdown: string;
  version: number;
  writtenBySomeoneElse: boolean;
};

type WriteSummaryInput = { sourceId: string; month: string; expectedVersion: number | null };

function validWriteInput(input: unknown): input is WriteSummaryInput {
  if (typeof input !== "object" || input === null) return false;
  const { sourceId, month, expectedVersion } = input as Record<string, unknown>;
  if (typeof sourceId !== "string" || typeof month !== "string") return false;
  if (expectedVersion === null) return true;
  return typeof expectedVersion === "number" && Number.isSafeInteger(expectedVersion) && expectedVersion > 0;
}

export async function writeSummaryAction(
  input: WriteSummaryInput,
): Promise<ActionResult<WriteSummaryActionData>> {
  if (!validWriteInput(input)) return fail(GENERIC_REFUSAL);

  const current = await actionSession();
  if ("expired" in current) return current.expired;

  if (!isValidMonthKey(input.month)) return fail(GENERIC_REFUSAL);
  const month: MonthKey = input.month;

  const source = await requireOwnedFundingSource(current, input.sourceId);
  if ("denied" in source) return source.denied;

  const access = await summariesAccessForOrg(current.orgId);
  if (!access.use) return fail(UI.summaryPlanNote);
  if (!access.write) return fail(UI.summaryWriteFailed);

  const key = summaryWriteKey(current.orgId, source.id, month);
  if (isSummaryWriting(current.orgId, source.id, month)) {
    return fail(UI.summaryAlreadyWriting(monthLabel(month)));
  }
  beginSummaryWrite(key);

  try {
    const limit = consume("summaryWrite", current.orgId);
    if (!limit.allowed) return fail(UI.summaryRateLimited);

    try {
      const existing = await currentSummaryRow(current.orgId, source.id, month);
      if (input.expectedVersion === null) {
        if (existing) {
          return ok({
            contentMarkdown: existing.contentMarkdown,
            version: existing.version,
            writtenBySomeoneElse: true,
          });
        }
      } else if (!existing || existing.version !== input.expectedVersion) {
        return fail(UI.summaryConflict);
      }

      const loaded = await loadMonthFacts(current.orgId, source.id, month);
      if (!loaded) return fail(GENERIC_REFUSAL);
      if (loaded.facts.overview.expenseCount === 0) return fail(UI.summaryNoExpenses);

      return await writeAndPersist({
        orgId: current.orgId,
        userId: current.userId,
        sourceId: source.id,
        month,
        facts: loaded.facts,
        fingerprint: loaded.fingerprint,
        expectedVersion: input.expectedVersion,
      });
    } catch (error) {
      console.error("write summary action failed", { orgId: current.orgId, sourceId: source.id, month });
      void error;
      return fail(UI.summaryWriteFailed);
    }
  } finally {
    endSummaryWrite(key);
  }
}

async function currentSummaryRow(
  orgId: string,
  sourceId: string,
  month: MonthKey,
  reader: Executor = db,
): Promise<{ version: number; contentMarkdown: string } | null> {
  const [row] = await reader
    .select({ version: monthlySummaries.version, contentMarkdown: monthlySummaries.contentMarkdown })
    .from(monthlySummaries)
    .where(
      and(
        eq(monthlySummaries.orgId, orgId),
        eq(monthlySummaries.fundingSourceId, sourceId),
        eq(monthlySummaries.month, month),
      ),
    )
    .limit(1);
  return row ?? null;
}

type DraftCheck =
  | { ok: true }
  | { ok: false; problems: { amounts: string[]; percents: string[]; structure: string | null } };

function checkDraft(markdown: string, facts: MonthFacts): DraftCheck {
  const structure = checkSummaryStructure(markdown);
  const figures = unsuppliedFigures(markdown, facts);
  if (structure.ok && figures.amounts.length === 0 && figures.percents.length === 0) return { ok: true };
  return {
    ok: false,
    problems: {
      amounts: figures.amounts,
      percents: figures.percents,
      structure: structure.ok ? null : structure.problem,
    },
  };
}

function sumTokens(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

type ModelOutcome = { outcome: "accepted"; markdown: string } | { outcome: "rejected" } | { outcome: "failed" };

/**
 * Attempt 1, then (P4) one automatic retry with `retryFeedbackFor` when the draft's figures or
 * structure don't check out. A transport/refusal failure on either attempt stops immediately —
 * only a checked-and-rejected draft gets the retry, never a failed call.
 */
async function runModelAttempts(
  facts: MonthFacts,
): Promise<{ result: ModelOutcome; inputTokens: number | null; outputTokens: number | null }> {
  const attempt1 = await writeSummary({ facts });
  if (attempt1.outcome === "failed") {
    return { result: { outcome: "failed" }, inputTokens: attempt1.inputTokens, outputTokens: attempt1.outputTokens };
  }

  const check1 = checkDraft(attempt1.markdown, facts);
  if (check1.ok) {
    return {
      result: { outcome: "accepted", markdown: attempt1.markdown },
      inputTokens: attempt1.inputTokens,
      outputTokens: attempt1.outputTokens,
    };
  }

  const attempt2 = await writeSummary({ facts, retryFeedback: retryFeedbackFor(check1.problems) });
  const inputTokens = sumTokens(attempt1.inputTokens, attempt2.inputTokens);
  const outputTokens = sumTokens(attempt1.outputTokens, attempt2.outputTokens);
  if (attempt2.outcome === "failed") {
    return { result: { outcome: "failed" }, inputTokens, outputTokens };
  }

  const check2 = checkDraft(attempt2.markdown, facts);
  if (check2.ok) {
    return { result: { outcome: "accepted", markdown: attempt2.markdown }, inputTokens, outputTokens };
  }
  return { result: { outcome: "rejected" }, inputTokens, outputTokens };
}

/** Step 9 (model) then step 10 (persist + log, one transaction) of `writeSummaryAction`. */
async function writeAndPersist(args: {
  orgId: string;
  userId: string;
  sourceId: string;
  month: MonthKey;
  facts: MonthFacts;
  fingerprint: string;
  expectedVersion: number | null;
}): Promise<ActionResult<WriteSummaryActionData>> {
  const { orgId, userId, sourceId, month, facts, fingerprint, expectedVersion } = args;
  const trigger: SummaryTrigger = expectedVersion === null ? "first" : "again";
  const model = process.env.OPENAI_SUMMARY_MODEL ?? "";

  const { result, inputTokens, outputTokens } = await runModelAttempts(facts);
  const cost = costMicroUsd(inputTokens, outputTokens, process.env, "summary");

  if (result.outcome !== "accepted") {
    // rejected/failed: nothing saved, but the run is always logged (P12).
    await db.insert(aiUsageEvents).values({
      orgId,
      userId,
      feature: "monthly_summary",
      fundingSourceId: sourceId,
      month,
      trigger,
      outcome: result.outcome,
      model,
      inputTokens,
      outputTokens,
      costMicroUsd: cost,
    });
    return fail(UI.summaryWriteFailed);
  }

  const markdown = result.markdown;
  const now = new Date();

  const persisted = await db.transaction(async (tx) => {
    let saved: WriteSummaryActionData | { conflict: true };

    if (trigger === "first") {
      const inserted = await tx
        .insert(monthlySummaries)
        .values({
          orgId,
          fundingSourceId: sourceId,
          month,
          contentMarkdown: markdown,
          version: 1,
          expensesFingerprint: fingerprint,
          writtenAt: now,
          writtenBy: userId,
          model,
        })
        .onConflictDoNothing({
          target: [monthlySummaries.orgId, monthlySummaries.fundingSourceId, monthlySummaries.month],
        })
        .returning({ version: monthlySummaries.version });

      if (inserted[0]) {
        saved = { contentMarkdown: markdown, version: inserted[0].version, writtenBySomeoneElse: false };
      } else {
        // Someone else's first write won the race — the draft this run wrote was still valid
        // and billed (outcome stays "success" below); the loser is shown the winner's summary.
        const existing = await currentSummaryRow(orgId, sourceId, month, tx);
        saved = existing ? { ...existing, writtenBySomeoneElse: true } : { conflict: true };
      }
    } else {
      const updated = await tx
        .update(monthlySummaries)
        .set({
          contentMarkdown: markdown,
          expensesFingerprint: fingerprint,
          writtenAt: now,
          writtenBy: userId,
          model,
          editedAt: null,
          editedBy: null,
          version: sql`${monthlySummaries.version} + 1`,
        })
        .where(
          and(
            eq(monthlySummaries.orgId, orgId),
            eq(monthlySummaries.fundingSourceId, sourceId),
            eq(monthlySummaries.month, month),
            eq(monthlySummaries.version, expectedVersion as number),
          ),
        )
        .returning({ version: monthlySummaries.version });
      saved = updated[0]
        ? { contentMarkdown: markdown, version: updated[0].version, writtenBySomeoneElse: false }
        : { conflict: true };
    }

    // The draft passed checks — billed and logged as "success" even if persisting then hit a
    // conflict, because the tokens were spent either way (Phase 11 §6).
    await tx.insert(aiUsageEvents).values({
      orgId,
      userId,
      feature: "monthly_summary",
      fundingSourceId: sourceId,
      month,
      trigger,
      outcome: "success",
      model,
      inputTokens,
      outputTokens,
      costMicroUsd: cost,
    });

    return saved;
  });

  if ("conflict" in persisted) return fail(UI.summaryConflict);
  return ok(persisted);
}

type SaveSummaryInput = { sourceId: string; month: string; markdown: string; expectedVersion: number };

function validSaveInput(input: unknown): input is SaveSummaryInput {
  if (typeof input !== "object" || input === null) return false;
  const { sourceId, month, markdown, expectedVersion } = input as Record<string, unknown>;
  return (
    typeof sourceId === "string" &&
    typeof month === "string" &&
    typeof markdown === "string" &&
    typeof expectedVersion === "number" &&
    Number.isSafeInteger(expectedVersion) &&
    expectedVersion > 0
  );
}

/** Used by both the Save button and autosave. Never touches `expenses_fingerprint` — only Write
 *  again re-reads the records (P7) — and runs no `monthLocked` check (P8). */
export async function saveSummaryAction(
  input: SaveSummaryInput,
): Promise<ActionResult<{ version: number }>> {
  if (!validSaveInput(input)) return fail(GENERIC_REFUSAL);

  const current = await actionSession();
  if ("expired" in current) return current.expired;

  if (!isValidMonthKey(input.month)) return fail(GENERIC_REFUSAL);
  const month: MonthKey = input.month;

  const source = await requireOwnedFundingSource(current, input.sourceId);
  if ("denied" in source) return source.denied;

  const access = await summariesAccessForOrg(current.orgId);
  if (!access.use) return fail(UI.summaryPlanNote);

  // Cheap UTF-16-length reject before the code-point count below, so a pathological paste can't
  // make every save pay for counting it.
  if (input.markdown.length > SUMMARY_MAX_CHARS * 2) return fail(UI.summaryTooLong);
  if (Array.from(input.markdown).length > SUMMARY_MAX_CHARS) return fail(UI.summaryTooLong);

  try {
    const updated = await db
      .update(monthlySummaries)
      .set({
        // Stored exactly as typed — never trimmed or normalised (P6).
        contentMarkdown: input.markdown,
        editedAt: new Date(),
        editedBy: current.userId,
        version: sql`${monthlySummaries.version} + 1`,
      })
      .where(
        and(
          eq(monthlySummaries.orgId, current.orgId),
          eq(monthlySummaries.fundingSourceId, source.id),
          eq(monthlySummaries.month, month),
          eq(monthlySummaries.version, input.expectedVersion),
        ),
      )
      .returning({ version: monthlySummaries.version });

    if (updated[0]) return ok({ version: updated[0].version });

    const existing = await currentSummaryRow(current.orgId, source.id, month);
    return fail(existing ? UI.summaryConflict : UI.summaryNotFound(monthLabel(month)));
  } catch (error) {
    console.error("save summary action failed", { orgId: current.orgId, sourceId: source.id, month });
    void error;
    return fail(UI.summaryWriteFailed);
  }
}
