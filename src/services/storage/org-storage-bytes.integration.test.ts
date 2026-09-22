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
  const { expenseDraftDocuments, expenseDrafts, expenseImports, lineItems, organizations } =
    await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { orgStorageBytes, orgStorageError, MAX_ORG_BYTES, ingestDraftDocument } = await import(
    "./documents"
  );

  let orgId: string;
  let fundingSourceId: string;
  let importId: string;
  let draftId: string;

  beforeAll(async () => {
    const org = await createTestOrg({ name: "Storage Bytes Org", docName: "StorageBytes", activeMonth: "2099-04" });
    orgId = org.orgId;
    fundingSourceId = org.fundingSourceId;

    const [item] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name: "Supplies", scheduledValueCents: 500_000, sortOrder: 0 })
      .returning({ id: lineItems.id });

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
