/**
 * Deleting a stored object only once nothing points at it any more.
 *
 * This is the half that makes re-pointing safe. One invoice is stored ONCE and becomes the
 * receipt on every expense it produced, all of them carrying the same `s3_key` — so a delete
 * that fired on the first row to go would take the file out from under the other twenty-four,
 * leaving `expense_documents` rows marked `attached` with nothing behind them. The
 * documentation gate (R4.6) trusts `attached`, so the packet build would be what discovered it.
 *
 * `objectStillReferenced` is private, and deliberately so: every delete path already routes
 * through `deleteStoredObjects`, which is where the check belongs. It is exercised here
 * through that function, against the real filesystem driver, because the thing being asserted
 * is whether the FILE survives — not whether a query returned true.
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

describe.skipIf(!hasDatabase)("a stored object outlives any one row that points at it", async () => {
  const { db } = await import("@/src/db");
  const {
    expenseDocuments,
    expenseImports,
    expenses,
    lineItems,
    monthLockEvents,
    organizations,
  } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { deleteStoredObjects } = await import("./documents");
  const { storage } = await import("./driver");

  const MONTH = "2098-06";

  let orgId: string;
  let fundingSourceId: string;
  let lineItemId: string;
  let expenseId: string;

  beforeAll(async () => {
    const org = await createTestOrg({ name: "Shared Objects Org", docName: "Shared", activeMonth: MONTH });
    orgId = org.orgId;
    fundingSourceId = org.fundingSourceId;

    const [item] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name: "Supplies", scheduledValueCents: 500_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemId = item.id;

    const [expense] = await db
      .insert(expenses)
      .values({
        orgId,
        fundingSourceId,
        lineItemId,
        month: MONTH,
        date: `${MONTH}-04`,
        name: "Holds a shared receipt",
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
        referenceSeq: 700,
      })
      .returning({ id: expenses.id });
    expenseId = expense.id;
  }, 30_000);

  afterAll(async () => {
    if (orgId) {
      await db.delete(organizations).where(eq(organizations.id, orgId));
      await rm(path.join(process.cwd(), ".storage", "org", orgId), { recursive: true, force: true });
    }
  });

  /** A real object on the real driver, so "did the file survive" is a real question. */
  async function storeObject(key: string) {
    await storage().put({ key, body: Buffer.from("invoice bytes"), contentType: "application/pdf" });
    expect(await storage().exists(key)).toBe(true);
  }

  function receiptRow(key: string, sortOrder: number) {
    return {
      orgId,
      expenseId,
      kind: "receipt" as const,
      status: "attached" as const,
      s3Key: key,
      filename: "invoice.pdf",
      mimeType: "application/pdf",
      sizeBytes: 13,
      thumbnailBytes: 0,
      sortOrder,
    };
  }

  it("survives while another expense_documents row still names it, and goes with the last one", async () => {
    const key = `org/${orgId}/shared-receipt-${Date.now()}`;
    await storeObject(key);

    const [first] = await db
      .insert(expenseDocuments)
      .values(receiptRow(key, 0))
      .returning({ id: expenseDocuments.id });
    const [second] = await db
      .insert(expenseDocuments)
      .values(receiptRow(key, 1))
      .returning({ id: expenseDocuments.id });

    // One row goes, as it would when someone removes that expense's receipt.
    await db.delete(expenseDocuments).where(eq(expenseDocuments.id, first.id));
    await deleteStoredObjects(key);
    // The other expense still points at these bytes, so they must still be there. Without the
    // guard this is where a 25-line invoice loses its file for the other 24 charges.
    expect(await storage().exists(key)).toBe(true);

    // The last row goes, so nothing names the object any more.
    await db.delete(expenseDocuments).where(eq(expenseDocuments.id, second.id));
    await deleteStoredObjects(key);
    expect(await storage().exists(key)).toBe(false);
  });

  it("survives while the import that owns it is still there", async () => {
    const key = `org/${orgId}/import-owned-${Date.now()}`;
    await storeObject(key);

    const [imported] = await db
      .insert(expenseImports)
      .values({
        orgId,
        fundingSourceId,
        month: MONTH,
        s3Key: key,
        filename: "invoice.pdf",
        mimeType: "application/pdf",
        sizeBytes: 13,
        pageCount: 1,
        sha256: "b".repeat(64),
      })
      .returning({ id: expenseImports.id });

    // The receipt row is removed from an expense, but the import still owns the file.
    const [doc] = await db
      .insert(expenseDocuments)
      .values(receiptRow(key, 2))
      .returning({ id: expenseDocuments.id });
    await db.delete(expenseDocuments).where(eq(expenseDocuments.id, doc.id));
    await deleteStoredObjects(key);
    expect(await storage().exists(key)).toBe(true);

    await db.delete(expenseImports).where(eq(expenseImports.id, imported.id));
    await deleteStoredObjects(key);
    expect(await storage().exists(key)).toBe(false);
  });

  it("survives while a signed packet names it (month_lock_events, the fifth table)", async () => {
    // Counted by `orgStorageBytes` but, until this was fixed, not checked here — so the two
    // lists disagreed and a signed packet's object could be deleted while its row named it.
    // Nothing shares a lock key today, which is exactly why it would have gone unnoticed.
    const key = `org/${orgId}/signed-packet-${Date.now()}`;
    await storeObject(key);

    await db.insert(monthLockEvents).values({
      orgId,
      fundingSourceId,
      month: MONTH,
      // A lock row IS one with an s3Key: the schema has no action column, the signed copy
      // is what distinguishes a lock from an unlock.
      s3Key: key,
      sizeBytes: 13,
    });

    await deleteStoredObjects(key);
    expect(await storage().exists(key)).toBe(true);

    await db.delete(monthLockEvents).where(eq(monthLockEvents.s3Key, key));
    await deleteStoredObjects(key);
    expect(await storage().exists(key)).toBe(false);
  });

  it("deletes an object nothing ever pointed at", async () => {
    // The ordinary case, so the guard cannot pass by simply never deleting anything.
    const key = `org/${orgId}/unreferenced-${Date.now()}`;
    await storeObject(key);

    await deleteStoredObjects(key);
    expect(await storage().exists(key)).toBe(false);
  });
});
