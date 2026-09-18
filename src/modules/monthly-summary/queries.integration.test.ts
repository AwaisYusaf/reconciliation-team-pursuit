/**
 * Integration tests for `loadMonthFacts`, `summariesAccessForOrg` and the monthly-summary
 * database constraints against a real Postgres (Phase 11, D-107). PHASE-11.md §10: I-33 (partly),
 * the "Constraint" and "monthly_summaries" bullets under §"Integration".
 *
 * Skipped when DATABASE_URL is absent.
 */
import { rm } from "node:fs/promises";
import path from "node:path";

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const MONTH = "2097-05"; // far future, avoids clashing with real data
const PREV_MONTH = "2097-04";

describe.skipIf(!hasDatabase)("monthly-summary queries (integration, Phase 11)", async () => {
  const { db } = await import("@/src/db");
  const { expenses, lineItems, lineItemPerformances, organizations, aiUsageEvents, monthlySummaries } = await import(
    "@/src/db/schema"
  );
  const { createTestOrg } = await import("@/src/db/test-org");
  const { loadMonthFacts, loadSummaryForDownload } = await import("./queries");
  const { factsFingerprint } = await import("./fingerprint");
  const { summariesAccessForOrg } = await import("@/src/modules/ai/access");
  const { loadSourceBudget } = await import("@/src/modules/dashboard/queries");

  let orgId: string;
  let fundingSourceId: string;
  let lineItemAId: string; // has a performance
  let lineItemBId: string;
  let otherOrgId: string;

  const savedEnv = {
    key: process.env.OPENAI_API_KEY,
    summaryModel: process.env.OPENAI_SUMMARY_MODEL,
  };

  let refSeq = 0;
  async function makeExpense(overrides: Partial<typeof expenses.$inferInsert> & { month: string }) {
    refSeq += 1;
    const [row] = await db
      .insert(expenses)
      .values({
        orgId,
        fundingSourceId,
        lineItemId: lineItemAId,
        date: `${overrides.month}-05`,
        name: "Expense",
        paymentSource: "Cash",
        subtotalCents: 1_000,
        taxCents: 0,
        feesCents: 0,
        taxReimbursable: false,
        feesReimbursable: false,
        sortOrder: 0,
        referenceSeq: refSeq,
        ...overrides,
      })
      .returning({ id: expenses.id });
    return row.id;
  }

  beforeAll(async () => {
    const org = await createTestOrg({ name: "Monthly Summary Facts Org", activeMonth: MONTH });
    orgId = org.orgId;
    fundingSourceId = org.fundingSourceId;
    await db.update(organizations).set({ plan: "reconciliation_ai" }).where(eq(organizations.id, orgId));

    const [itemA] = await db
      .insert(lineItems)
      .values({
        orgId,
        fundingSourceId,
        name: "Salary",
        scheduledValueCents: 500_000,
        openingBilledCents: 20_000,
        sortOrder: 0,
      })
      .returning({ id: lineItems.id });
    lineItemAId = itemA.id;

    await db.insert(lineItemPerformances).values({
      orgId,
      lineItemId: lineItemAId,
      amountCents: 30_000,
      name: "Spring concert",
      date: `${MONTH}-01`,
      countsTowardContractTotal: true,
    });

    const [itemB] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name: "Travel", scheduledValueCents: 100_000, sortOrder: 1 })
      .returning({ id: lineItems.id });
    lineItemBId = itemB.id;

    // Prior-month expense (line item A).
    await makeExpense({ month: PREV_MONTH, lineItemId: lineItemAId, name: "March payroll", subtotalCents: 12_000 });
    // Refund in the target month (line item A).
    await makeExpense({ month: MONTH, lineItemId: lineItemAId, name: "Refund", subtotalCents: -2_500 });
    // Excluded-tax expense in the target month (line item B).
    await makeExpense({
      month: MONTH,
      lineItemId: lineItemBId,
      name: "Hotel",
      subtotalCents: 8_000,
      taxCents: 640,
      feesCents: 0,
      taxReimbursable: false,
      feesReimbursable: false,
    });
    // Trashed expense in the target month — must not be counted anywhere.
    const trashedId = await makeExpense({
      month: MONTH,
      lineItemId: lineItemAId,
      name: "Should not count",
      subtotalCents: 999_999,
    });
    await db.update(expenses).set({ deletedAt: new Date() }).where(eq(expenses.id, trashedId));

    const other = await createTestOrg({ name: "Monthly Summary Facts Other Org" });
    otherOrgId = other.orgId;
  }, 30_000);

  afterAll(async () => {
    process.env.OPENAI_API_KEY = savedEnv.key;
    if (savedEnv.summaryModel === undefined) delete process.env.OPENAI_SUMMARY_MODEL;
    else process.env.OPENAI_SUMMARY_MODEL = savedEnv.summaryModel;
    if (orgId) {
      await db.delete(organizations).where(eq(organizations.id, orgId));
      await rm(path.join(process.cwd(), ".storage", "org", orgId), { recursive: true, force: true });
    }
    if (otherOrgId) {
      await db.delete(organizations).where(eq(organizations.id, otherOrgId));
      await rm(path.join(process.cwd(), ".storage", "org", otherOrgId), { recursive: true, force: true });
    }
  });

  describe("loadMonthFacts", () => {
    it("figures match loadSourceBudget exactly, and the trashed expense is excluded from both", async () => {
      const result = await loadMonthFacts(orgId, fundingSourceId, MONTH);
      expect(result).not.toBeNull();
      const { facts, fingerprint } = result!;

      const budget = await loadSourceBudget(orgId, fundingSourceId, MONTH);

      for (const position of budget.positions) {
        const row = facts.budget.lineItems.find((r) => r.name === position.name)!;
        expect(row.spentThisMonth.cents).toBe(position.thisMonthCents);
        expect(row.remaining.cents).toBe(position.closingCents);
        expect(row.scheduled.cents).toBe(position.scheduledCents);
      }
      expect(facts.budget.overall.approved.cents).toBe(budget.grant.approvedCents);
      expect(facts.budget.overall.spentToDate.cents).toBe(budget.grant.spentToDateCents);
      expect(facts.budget.overall.remaining.cents).toBe(budget.grant.remainingCents);

      // The trashed 999,999-cent expense would dominate every total if it leaked in.
      expect(facts.overview.totalSpent.cents).toBeLessThan(999_999);
      for (const row of facts.budget.lineItems) expect(row.spentThisMonth.cents).toBeLessThan(999_999);

      // The fingerprint is of exactly these facts (PR #18 round 2, #7), so the trashed row,
      // excluded from the totals above, is excluded from it too.
      expect(fingerprint).toBe(factsFingerprint(facts));
    });

    it("returns null for another organisation's funding source id", async () => {
      const result = await loadMonthFacts(otherOrgId, fundingSourceId, MONTH);
      expect(result).toBeNull();
    });

    it("returns null for an invalid month key", async () => {
      expect(await loadMonthFacts(orgId, fundingSourceId, "2097-13")).toBeNull();
      expect(await loadMonthFacts(orgId, fundingSourceId, "not-a-month")).toBeNull();
    });

    it("returns null for a non-uuid source id", async () => {
      expect(await loadMonthFacts(orgId, "not-a-uuid", MONTH)).toBeNull();
    });

    it("returns null for a well-formed but non-existent source id", async () => {
      expect(await loadMonthFacts(orgId, "00000000-0000-0000-0000-000000000000", MONTH)).toBeNull();
    });
  });

  describe("loadSummaryForDownload — org scoping at the loader itself, independent of the route's own findFundingSource guard", () => {
    const DOWNLOAD_MONTH = "2097-09";

    it("returns the content for the owning org", async () => {
      await db.insert(monthlySummaries).values({
        orgId,
        fundingSourceId,
        month: DOWNLOAD_MONTH,
        contentMarkdown: "## Overview\nOwner-only content.",
        version: 1,
        expensesFingerprint: "0".repeat(64),
        writtenAt: new Date(),
        model: "gpt-5.6-terra",
      });

      const loaded = await loadSummaryForDownload(orgId, fundingSourceId, DOWNLOAD_MONTH);
      expect(loaded).not.toBeNull();
      expect(loaded!.contentMarkdown).toBe("## Overview\nOwner-only content.");
    });

    it("a real, saved row for org A's funding source is refused (null) when requested under org B's id, even though the row genuinely exists", async () => {
      const loaded = await loadSummaryForDownload(otherOrgId, fundingSourceId, DOWNLOAD_MONTH);
      expect(loaded).toBeNull();
    });
  });

  describe("summariesAccessForOrg", () => {
    it("AI plan with key and summary model set: use and write both true", async () => {
      await db.update(organizations).set({ plan: "reconciliation_ai" }).where(eq(organizations.id, orgId));
      vi.stubEnv("OPENAI_API_KEY", "sk-real");
      vi.stubEnv("OPENAI_SUMMARY_MODEL", "gpt-5.6-terra");
      try {
        expect(await summariesAccessForOrg(orgId)).toEqual({ use: true, write: true });
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("base plan: use and write both false even when the server is fully configured", async () => {
      await db.update(organizations).set({ plan: "reconciliation" }).where(eq(organizations.id, orgId));
      vi.stubEnv("OPENAI_API_KEY", "sk-real");
      vi.stubEnv("OPENAI_SUMMARY_MODEL", "gpt-5.6-terra");
      try {
        expect(await summariesAccessForOrg(orgId)).toEqual({ use: false, write: false });
      } finally {
        vi.unstubAllEnvs();
        await db.update(organizations).set({ plan: "reconciliation_ai" }).where(eq(organizations.id, orgId));
      }
    });

    it("missing org: both false", async () => {
      expect(await summariesAccessForOrg("00000000-0000-0000-0000-000000000000")).toEqual({
        use: false,
        write: false,
      });
    });
  });

  describe("ai_usage_events constraints (Phase 11, D-107, P12)", () => {
    async function refused(values: Record<string, unknown>) {
      const base = { orgId, feature: "monthly_summary" as const, model: "gpt-5.6-terra" };
      const error = await db
        .insert(aiUsageEvents)
        .values({ ...base, ...values } as typeof aiUsageEvents.$inferInsert)
        .then(() => null, (e: unknown) => e);
      expect(String((error as { cause?: unknown })?.cause ?? error)).toContain("ai_usage_events_monthly_summary_ck");
    }

    it("rejects a monthly_summary row missing funding_source_id, month, or trigger", async () => {
      await refused({ outcome: "success", month: MONTH, trigger: "first" }); // missing source
      await refused({ outcome: "success", fundingSourceId, trigger: "first" }); // missing month
      await refused({ outcome: "success", fundingSourceId, month: MONTH }); // missing trigger
    });

    it("rejects a monthly_summary row with an out-of-set outcome ('found' is an amount-read outcome)", async () => {
      await refused({ outcome: "found", fundingSourceId, month: MONTH, trigger: "first" });
    });

    it("accepts a complete monthly_summary row", async () => {
      await db
        .insert(aiUsageEvents)
        .values({
          orgId,
          feature: "monthly_summary",
          model: "gpt-5.6-terra",
          outcome: "success",
          fundingSourceId,
          month: MONTH,
          trigger: "first",
        });
    });

    it("an amount_read row is still accepted, unaffected by the new constraint", async () => {
      await db.insert(aiUsageEvents).values({
        orgId,
        feature: "amount_read",
        model: "gpt-5.6-luna",
        outcome: "none",
        documentSource: "upload",
        documentKind: "receipt",
      });
    });
  });

  describe("monthly_summaries constraints", () => {
    function summaryRow(overrides: Partial<typeof monthlySummaries.$inferInsert> = {}) {
      return {
        orgId,
        fundingSourceId,
        month: MONTH,
        contentMarkdown: "content",
        expensesFingerprint: "0".repeat(64),
        writtenAt: new Date(),
        model: "gpt-5.6-terra",
        ...overrides,
      };
    }

    it("rejects a bad month key", async () => {
      const error = await db
        .insert(monthlySummaries)
        .values(summaryRow({ month: "2097-13" }))
        .then(() => null, (e: unknown) => e);
      expect(String((error as { cause?: unknown })?.cause ?? error)).toContain("monthly_summaries_month_ck");
    });

    it("rejects content over 60,000 characters", async () => {
      const error = await db
        .insert(monthlySummaries)
        .values(summaryRow({ month: "2097-06", contentMarkdown: "a".repeat(60_001) }))
        .then(() => null, (e: unknown) => e);
      expect(String((error as { cause?: unknown })?.cause ?? error)).toContain("monthly_summaries_content_length_ck");
    });

    it("accepts content at exactly 60,000 characters", async () => {
      await db.insert(monthlySummaries).values(summaryRow({ month: "2097-07", contentMarkdown: "a".repeat(60_000) }));
    });

    it("rejects a duplicate (org, funding_source, month)", async () => {
      await db.insert(monthlySummaries).values(summaryRow({ month: "2097-08" }));
      const error = await db
        .insert(monthlySummaries)
        .values(summaryRow({ month: "2097-08" }))
        .then(() => null, (e: unknown) => e);
      expect(error).not.toBeNull();
      expect(String((error as { cause?: unknown })?.cause ?? error)).toMatch(
        /monthly_summaries_source_month_uq|duplicate key/,
      );
    });
  });
});
