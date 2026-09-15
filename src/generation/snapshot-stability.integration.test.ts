/**
 * Phase 0 preflight for docs/PHASE-6.md (P0.2) — the safety net for the whole multi-grant
 * migration.
 *
 * Fixes every id, date and counter so `loadMonthSnapshot`'s output, and therefore
 * `inputsHash`, is fully deterministic across runs (ids are v7/random by default, which
 * would change the hash every time). The three hashes below are recorded from the current
 * code, before any Phase 1+ schema change. From Phase 1 onward only the **setup** of this
 * test may change (it must also create the funding source with a fixed id, once that table
 * exists) — the expected constants must **never** change. If they would, that is a change
 * in what an existing single-source organisation's documents contain, and the plan says to
 * STOP and report rather than "fix" this test.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("snapshot stability (integration)", async () => {
  const { db } = await import("@/src/db");
  const {
    contractSettings,
    expenses,
    fundingSources,
    lineItemPerformances,
    lineItems,
    monthDocuments,
    organizations,
  } = await import("@/src/db/schema");
  const { ORIGINAL_RULES } = await import("@/src/modules/expenses/reimbursement");
  const { inputsHash } = await import("./cache-key");
  const { loadMonthSnapshot } = await import("./month-snapshot");

  const ORG_ID = "00000000-0000-0000-0000-000000000001";
  const LINE_ITEM_1_ID = "00000000-0000-0000-0000-000000000002";
  const LINE_ITEM_2_ID = "00000000-0000-0000-0000-000000000003";
  const PERFORMANCE_ID = "00000000-0000-0000-0000-000000000004";
  const EXPENSE_1_ID = "00000000-0000-0000-0000-000000000005";
  const EXPENSE_2_ID = "00000000-0000-0000-0000-000000000006";
  const EXPENSE_3_ID = "00000000-0000-0000-0000-000000000007";
  const MONTH_DOCUMENT_ID = "00000000-0000-0000-0000-000000000008";
  // Fixed, same reasoning as every other id here. From Phase 2 on `loadMonthSnapshot` takes
  // it as an explicit scope argument, but it is never folded into the hashed snapshot itself
  // (decision 2.8) — only its presence is required for the inserts below to succeed and for
  // the loader call.
  const FUNDING_SOURCE_ID = "00000000-0000-0000-0000-000000000009";

  const MONTH = "2026-02";

  beforeAll(async () => {
    await db.insert(organizations).values({
      id: ORG_ID,
      name: "Stability Org",
      docName: "Stability",
      activeMonth: MONTH,
    });

    // From Phase 2 on, `loadMonthSnapshot`'s `settings` come from this row instead of
    // `contract_settings` (decision 2.8) — the same values the migration would have copied
    // onto a migrated org's first source, so the hash stays what it was before the switch.
    await db.insert(fundingSources).values({
      id: FUNDING_SOURCE_ID,
      orgId: ORG_ID,
      name: "Source 1",
      type: "grant",
      sortOrder: 0,
      projectName: "Stability Project",
      contractNumber: "C-100",
      basePoNumber: "PO-1",
      performancePoNumber: "PO-2",
      contractValueCents: 940_000_00,
      contractStart: "2026-01-01",
      contractEnd: "2026-12-31",
      fiduciaryName: "Stability Fiduciary",
      advancesReceivedCents: 10_000_00,
      ...ORIGINAL_RULES,
    });

    // Kept alongside the source row: `contract_settings` still exists (deprecated, 2.4) and
    // this proves nothing here still reads it — `loadMonthSnapshot` no longer joins it.
    await db.insert(contractSettings).values({
      orgId: ORG_ID,
      projectName: "Stability Project",
      contractNumber: "C-100",
      basePoNumber: "PO-1",
      performancePoNumber: "PO-2",
      contractValueCents: 940_000_00,
      contractStart: "2026-01-01",
      contractEnd: "2026-12-31",
      fiduciaryName: "Stability Fiduciary",
      advancesReceivedCents: 10_000_00,
    });

    await db.insert(lineItems).values([
      {
        id: LINE_ITEM_1_ID,
        orgId: ORG_ID,
        fundingSourceId: FUNDING_SOURCE_ID,
        name: "Salary",
        scheduledValueCents: 500_000_00,
        openingBilledCents: 0,
        sortOrder: 0,
      },
      {
        id: LINE_ITEM_2_ID,
        orgId: ORG_ID,
        fundingSourceId: FUNDING_SOURCE_ID,
        name: "Travel",
        scheduledValueCents: 50_000_00,
        openingBilledCents: 0,
        sortOrder: 1,
      },
    ]);

    await db.insert(lineItemPerformances).values({
      id: PERFORMANCE_ID,
      orgId: ORG_ID,
      lineItemId: LINE_ITEM_1_ID,
      amountCents: 20_000_00,
      name: "Performance 1",
      date: "2026-02-01",
      sortOrder: 0,
      countsTowardContractTotal: true,
    });

    await db.insert(expenses).values([
      {
        id: EXPENSE_1_ID,
        orgId: ORG_ID,
        fundingSourceId: FUNDING_SOURCE_ID,
        lineItemId: LINE_ITEM_1_ID,
        month: MONTH,
        date: "2026-02-05",
        name: "February payroll",
        description: "Payroll",
        paymentSource: "Paid by us",
        subtotalCents: 10_000_00,
        taxCents: 0,
        feesCents: 0,
        taxReimbursable: false,
        feesReimbursable: true,
        note: null,
        narrative: null,
        noReceipt: false,
        noReceiptReason: null,
        sortOrder: 0,
        referenceSeq: 1,
      },
      {
        id: EXPENSE_2_ID,
        orgId: ORG_ID,
        fundingSourceId: FUNDING_SOURCE_ID,
        lineItemId: LINE_ITEM_2_ID,
        month: MONTH,
        date: "2026-02-10",
        name: "Flight to conference",
        description: "Travel",
        paymentSource: "Paid directly by fiduciary",
        subtotalCents: 45_000,
        taxCents: 2_700,
        feesCents: 500,
        taxReimbursable: true,
        feesReimbursable: true,
        note: "Booked in advance",
        narrative: "Round trip for the annual conference.",
        noReceipt: false,
        noReceiptReason: null,
        sortOrder: 1,
        referenceSeq: 2,
      },
      {
        id: EXPENSE_3_ID,
        orgId: ORG_ID,
        fundingSourceId: FUNDING_SOURCE_ID,
        lineItemId: LINE_ITEM_1_ID,
        month: MONTH,
        date: "2026-02-20",
        name: "Cash reimbursement",
        description: "Payroll",
        paymentSource: "Paid by us",
        subtotalCents: 5_000,
        taxCents: 0,
        feesCents: 0,
        taxReimbursable: false,
        feesReimbursable: true,
        note: null,
        narrative: null,
        noReceipt: true,
        noReceiptReason: "Receipt lost; approved by fiduciary.",
        sortOrder: 2,
        referenceSeq: 3,
      },
    ]);

    await db.insert(monthDocuments).values({
      id: MONTH_DOCUMENT_ID,
      orgId: ORG_ID,
      fundingSourceId: FUNDING_SOURCE_ID,
      month: MONTH,
      category: "bank_statement",
      title: "February bank statement",
      status: "attached",
      s3Key: "fake/stability-org/2026-02/bank-statement.pdf",
      filename: "bank-statement.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12_345,
      pageCount: 2,
      widthPx: 1275,
      heightPx: 1650,
      sortOrder: 0,
    });
  });

  afterAll(async () => {
    await db.delete(organizations).where(eq(organizations.id, ORG_ID));
  });

  it("hashes the packet, summary and cover-sheet inputs to fixed constants", async () => {
    const snapshot = await loadMonthSnapshot(ORG_ID, FUNDING_SOURCE_ID, MONTH);

    expect(inputsHash({ snapshot, generatorVersion: "packet-12" })).toBe(
      "601381160f2166473a81f5f98c10f241",
    );
    expect(inputsHash({ snapshot, generatorVersion: "summary-3" })).toBe(
      "a1f585da578923e390594d20e51909ec",
    );
    expect(
      inputsHash({
        snapshot,
        generatorVersion: "cover-8",
        scope: `${LINE_ITEM_1_ID}:docx`,
      }),
    ).toBe("192530834a87031782768c8d21476130");
  });
});
