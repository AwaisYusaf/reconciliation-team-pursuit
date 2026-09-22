/**
 * Regression: `orgStorageBytes` now also sums `expense_draft_documents` and `expense_imports`
 * (Phase 14) — before the fix, an org whose only stored bytes lived in those two tables reported
 * a usage of ZERO, so the quota cap could never trip for a fully-invoice-driven org.
 *
 * Also covers the `ingestDraftDocument` regression: a non-UUID `draftId` now reads as "That
 * draft no longer exists." instead of raising a Postgres 22P02.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { rm } from "node:fs/promises";
import path from "node:path";

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("orgStorageBytes counts every stored-object table (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenseDocuments, expenseDraftDocuments, expenseDrafts, expenseImports, expenses, lineItems, organizations } =
    await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { orgStorageBytes, orgStorageError, MAX_ORG_BYTES, ingestDraftDocument } = await import(
    "./documents"
  );

  let orgId: string;
  let fundingSourceId: string;
  let importId: string;
  let draftId: string;
  let lineItemId: string;

  beforeAll(async () => {
    const org = await createTestOrg({ name: "Storage Bytes Org", docName: "StorageBytes", activeMonth: "2099-04" });
    orgId = org.orgId;
    fundingSourceId = org.fundingSourceId;

    const [item] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name: "Supplies", scheduledValueCents: 500_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemId = item.id;

    const [imported] = await db
      .insert(expenseImports)
      .values({
        orgId,
        fundingSourceId,
        month: "2099-04",
        s3Key: `test/storage-bytes-${Date.now()}.pdf`,
        filename: "invoice.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1_000_000,
        pageCount: 1,
        sha256: "e".repeat(64),
      })
      .returning({ id: expenseImports.id });
    importId = imported.id;

    const [draft] = await db
      .insert(expenseDrafts)
      .values({
        importId,
        orgId,
        fundingSourceId,
        month: "2099-04",
        date: "2099-04-10",
        name: "Draft with a file",
        paymentSource: "Operating account",
        subtotalCents: 5000,
        lineItemId: item.id,
        narrative: "For the storage test.",
        sortOrder: 0,
      })
      .returning({ id: expenseDrafts.id });
    draftId = draft.id;

    await db.insert(expenseDraftDocuments).values({
      orgId,
      draftId,
      kind: "receipt",
      status: "attached",
      s3Key: `test/storage-bytes-doc-${Date.now()}`,
      filename: "receipt.png",
      mimeType: "image/png",
      sizeBytes: 500_000,
      thumbnailBytes: 1_000,
      sortOrder: 0,
    });
  });

  afterAll(async () => {
    if (orgId) {
      await db.delete(organizations).where(eq(organizations.id, orgId));
      await rm(path.join(process.cwd(), ".storage", "org", orgId), { recursive: true, force: true });
    }
  });

  it("reports the expense_imports and expense_draft_documents bytes — zero before the fix", async () => {
    const used = await orgStorageBytes(db, orgId);
    // 1,000,000 (import) + 500,000 + 1,000 (draft doc + its thumbnail) = 1,501,000.
    expect(used).toBe(1_501_000);
  });

  it("counts a photographed invoice's preview square, which is stored beside it", async () => {
    // An imported photo stores a thumbnail as well as the file, and the receipt rows that
    // re-point at it carry its size. Summing only `size_bytes` here left those bytes real
    // spend the 5 GB cap could not see — the same hole the draft and import rows had.
    const before = await orgStorageBytes(db, orgId);
    if (before === null) throw new Error("the fixture organisation should have a total");

    await db
      .update(expenseImports)
      .set({ thumbnailBytes: 12_000 })
      .where(eq(expenseImports.id, importId));
    try {
      expect(await orgStorageBytes(db, orgId)).toBe(before + 12_000);
    } finally {
      await db.update(expenseImports).set({ thumbnailBytes: 0 }).where(eq(expenseImports.id, importId));
    }
  });

  it("charges one stored object once, however many rows point at it", async () => {
    /**
     * The invoice is stored ONCE and re-pointed: approving a draft, and saving a charge
     * straight as an expense, both write an `expense_documents` receipt row carrying the
     * import's own `s3_key` rather than a second copy of the file. Summing the rows would
     * charge a 25-line invoice 26 times for one file, which is exactly the cost re-pointing
     * exists to avoid — and the admin usage figure reads this same function, so it would
     * report storage the bucket does not hold.
     */
    const before = await orgStorageBytes(db, orgId);

    const [imported] = await db
      .select({ key: expenseImports.s3Key, size: expenseImports.sizeBytes })
      .from(expenseImports)
      .where(eq(expenseImports.id, importId));

    // Three expenses, all of them the receipt on the SAME object.
    const [expense] = await db
      .insert(expenses)
      .values({
        orgId,
        fundingSourceId,
        lineItemId,
        month: "2099-04",
        date: "2099-04-09",
        name: "Shares the invoice",
        description: "",
        paymentSource: "Operating account",
        subtotalCents: 1_000,
        taxCents: 0,
        feesCents: 0,
        taxReimbursable: false,
        feesReimbursable: true,
        noReceipt: false,
        noReceiptReason: null,
        sortOrder: 0,
        referenceSeq: 900,
      })
      .returning({ id: expenses.id });

    for (let copy = 0; copy < 3; copy += 1) {
      await db.insert(expenseDocuments).values({
        orgId,
        expenseId: expense.id,
        kind: "receipt",
        status: "attached",
        s3Key: imported.key,
        filename: "invoice.pdf",
        mimeType: "application/pdf",
        sizeBytes: imported.size,
        thumbnailBytes: 0,
        sortOrder: 10 + copy,
      });
    }

    // Not one byte more: the object was already counted, as the import's.
    expect(await orgStorageBytes(db, orgId)).toBe(before);

    await db.delete(expenses).where(eq(expenses.id, expense.id));
  });

  it("orgStorageError refuses at the cap once these two tables alone fill it", async () => {
    // Top the org up using ONLY an expense_imports row (the cheapest way to reach the cap
    // without touching expense_documents/month_documents, which are already summed correctly).
    const [ballast] = await db
      .insert(expenseImports)
      .values({
        orgId,
        fundingSourceId,
        month: "2099-04",
        s3Key: `test/storage-bytes-ballast-${Date.now()}.pdf`,
        filename: "ballast.pdf",
        mimeType: "application/pdf",
        sizeBytes: MAX_ORG_BYTES,
        pageCount: 1,
        sha256: "f".repeat(64),
      })
      .returning({ id: expenseImports.id });

    try {
      const error = await orgStorageError(db, orgId, 1);
      expect(error).not.toBeNull();
      expect(error).toContain("MB");
    } finally {
      await db.delete(expenseImports).where(eq(expenseImports.id, ballast.id));
    }
  });

  it("ingestDraftDocument rejects a non-UUID draftId cleanly instead of a Postgres 22P02", async () => {
    const result = await ingestDraftDocument({
      orgId,
      draftId: "not-a-uuid",
      scope: "receipt",
      file: new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" }),
    });
    expect(result).toEqual({ ok: false, error: "That draft no longer exists." });
  });
});
