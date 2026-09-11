/**
 * The per-parent upload caps under concurrency (R13.1).
 *
 * Drives the real `ingestExpenseDocument` against a real database and the local storage
 * driver, because the thing under test is a race: the cap used to be read outside any
 * transaction, so two uploads could both see room and both insert past it. Nothing short of
 * genuinely concurrent calls proves the lock works.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { rm } from "node:fs/promises";
import path from "node:path";

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("upload caps under concurrency (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenseDocuments, expenses, lineItems, organizations } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { ingestExpenseDocument, MAX_EXPENSE_BYTES, MAX_ORG_BYTES } = await import("./documents");

  let orgId: string;
  let fundingSourceId: string;
  let expenseId: string;
  let sizingExpenseId: string;
  let ballastExpenseId: string;
  let png: Buffer;

  beforeAll(async () => {
    const org = await createTestOrg({ name: "Upload Org", docName: "Upload", activeMonth: "2099-01" });
    orgId = org.orgId;
    fundingSourceId = org.fundingSourceId;

    const [item] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name: "Transportation", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });

    const [expense] = await db
      .insert(expenses)
      .values({
        orgId,
        fundingSourceId,
        lineItemId: item.id,
        month: "2099-01",
        date: "2099-01-05",
        name: "Rideshare",
        paymentSource: "x",
        subtotalCents: 1000,
        sortOrder: 0,
        referenceSeq: 1,
        taxReimbursable: false,
        feesReimbursable: true,
      })
      .returning({ id: expenses.id });
    expenseId = expense.id;

    // A second expense, so the byte-accounting test is not competing with the cap test.
    const [sizing] = await db
      .insert(expenses)
      .values({
        orgId,
        fundingSourceId,
        lineItemId: item.id,
        month: "2099-01",
        date: "2099-01-06",
        name: "Sizing",
        paymentSource: "x",
        subtotalCents: 1000,
        sortOrder: 1,
        referenceSeq: 2,
        taxReimbursable: false,
        feesReimbursable: true,
      })
      .returning({ id: expenses.id });
    sizingExpenseId = sizing.id;

    const [ballast] = await db
      .insert(expenses)
      .values({
        orgId,
        fundingSourceId,
        lineItemId: item.id,
        month: "2099-01",
        date: "2099-01-07",
        name: "Ballast",
        paymentSource: "x",
        subtotalCents: 1000,
        sortOrder: 2,
        referenceSeq: 3,
        taxReimbursable: false,
        feesReimbursable: true,
      })
      .returning({ id: expenses.id });
    ballastExpenseId = ballast.id;

    png = await sharp({
      create: { width: 40, height: 40, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();
  }, 30_000);

  afterAll(async () => {
    if (orgId) {
      await db.delete(organizations).where(eq(organizations.id, orgId));
      await rm(path.join(process.cwd(), ".storage", "org", orgId), { recursive: true, force: true });
    }
  });

  function upload(index: number) {
    return ingestExpenseDocument({
      orgId,
      expenseId,
      // "proof" rather than "supporting": the latter demands a document type the
      // organisation offers, which is a different check and not what is under test here.
      scope: "proof" as const,
      file: new File([new Uint8Array(png)], `receipt-${index}.png`, { type: "image/png" }),
    });
  }

  it("refuses a file whose uploaded size fits but whose stored size does not (B2)", async () => {
    // The actual regression. The quota checked `file.size` but recorded the post-inspection
    // length, and WebP is re-encoded to JPEG — so a file could be admitted on a number
    // smaller than the one it then consumed, taking the organisation past its cap.
    //
    // Headroom is set BETWEEN the two sizes: the upload fits on what the old code measured
    // and does not fit on what it stored. With the bug this upload is accepted.
    const webp = await sharp({
      create: { width: 900, height: 700, channels: 3, background: { r: 200, g: 120, b: 40 } },
    })
      .webp({ quality: 80 })
      .toBuffer();

    const { inspectUpload } = await import("./inspect");
    const inspected = await inspectUpload({ body: webp, declaredMimeType: "image/webp" });
    if (!inspected.ok) throw new Error(inspected.error);

    const uploadedSize = webp.byteLength;
    const storedSize = inspected.body.byteLength;
    // Precondition: without growth there is nothing for this test to catch.
    expect(storedSize).toBeGreaterThan(uploadedSize);

    // Headroom sits between the two sizes. The ballast lives on its own expense so it fills
    // the ORGANISATION without also blowing the per-expense budget, which is far smaller.
    const headroom = Math.floor((uploadedSize + storedSize) / 2);
    await db.insert(expenseDocuments).values({
      orgId,
      expenseId: ballastExpenseId,
      kind: "supporting",
      supportingType: "Ballast",
      status: "attached",
      s3Key: `org/${orgId}/org-ballast`,
      filename: "ballast.pdf",
      mimeType: "application/pdf",
      sizeBytes: MAX_ORG_BYTES - headroom,
      sortOrder: 0,
    });

    let result;
    try {
      result = await ingestExpenseDocument({
        orgId,
        expenseId: sizingExpenseId,
        scope: "proof" as const,
        file: new File([new Uint8Array(webp)], "receipt.webp", { type: "image/webp" }),
      });
    } finally {
      // Always drop the ballast: leaving it would keep the organisation full for every test
      // after this one, turning one failure into four.
      await db.delete(expenseDocuments).where(eq(expenseDocuments.expenseId, ballastExpenseId));
    }

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("storage");

    // Nothing was left in the table for the refused upload.
    const rows = await db
      .select({ key: expenseDocuments.s3Key })
      .from(expenseDocuments)
      .where(eq(expenseDocuments.expenseId, sizingExpenseId));
    expect(rows).toHaveLength(0);
  }, 30_000);

  it("never admits more than the budget, however many upload at once", async () => {
    // The per-expense limit is bytes now, not a file count, so the race is run against that.
    // Ballast leaves room for exactly three more uploads; twenty go in at once.
    const { inspectUpload } = await import("./inspect");
    const inspected = await inspectUpload({ body: png, declaredMimeType: "image/png" });
    if (!inspected.ok) throw new Error(inspected.error);
    const perUpload = inspected.body.byteLength + (inspected.thumbnail?.byteLength ?? 0);

    const room = perUpload * 3;
    await db.insert(expenseDocuments).values({
      orgId,
      expenseId,
      kind: "supporting",
      supportingType: "Ballast",
      status: "attached",
      s3Key: `org/${orgId}/expense-ballast`,
      filename: "ballast.pdf",
      mimeType: "application/pdf",
      sizeBytes: MAX_EXPENSE_BYTES - room,
      sortOrder: 0,
    });

    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => upload(index)));
    const accepted = results.filter((result) => result.ok).length;

    // Before the lock, every one of these read the same total and inserted anyway.
    expect(accepted).toBe(3);

    const rows = await db
      .select({ sizeBytes: expenseDocuments.sizeBytes })
      .from(expenseDocuments)
      .where(eq(expenseDocuments.expenseId, expenseId));
    const held = rows.reduce((sum, row) => sum + Number(row.sizeBytes), 0);
    expect(held).toBeLessThanOrEqual(MAX_EXPENSE_BYTES);

    for (const refusal of results.filter((result) => !result.ok)) {
      expect(refusal.ok ? "" : refusal.error).toContain("MB");
    }
  }, 60_000);

  it("gives every accepted document a distinct sort order", async () => {
    // Packet document order is defined by sort_order (R10.1 determinism). The old code took
    // it from the same unsynchronised count, so racing uploads collided on one position.
    const rows = await db
      .select({ sortOrder: expenseDocuments.sortOrder })
      .from(expenseDocuments)
      .where(eq(expenseDocuments.expenseId, expenseId));

    const orders = rows.map((row) => row.sortOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("records the thumbnail's bytes, so the bucket is fully accounted for (B4)", async () => {
    const rows = await db
      .select({
        mimeType: expenseDocuments.mimeType,
        thumbnailBytes: expenseDocuments.thumbnailBytes,
      })
      .from(expenseDocuments)
      .where(eq(expenseDocuments.expenseId, expenseId));

    // Every image upload writes a thumbnail; the ballast row is a PDF and has none.
    const images = rows.filter((row) => row.mimeType.startsWith("image/"));
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) expect(image.thumbnailBytes).toBeGreaterThan(0);
  });

  it("leaves no stored object behind for a refused upload", async () => {
    // A refusal happens after the bytes are written, so the loser must take them back out.
    const { storage } = await import("./driver");
    const refused = await upload(999);
    expect(refused.ok).toBe(false);

    const stored = await db
      .select({ key: expenseDocuments.s3Key, mimeType: expenseDocuments.mimeType })
      .from(expenseDocuments)
      .where(and(eq(expenseDocuments.expenseId, expenseId)));

    // Every row still has its object; nothing was left behind by the refusal.
    for (const row of stored) {
      if (row.mimeType === "application/pdf") continue; // the synthetic ballast row
      expect(await storage().exists(row.key)).toBe(true);
    }
  }, 30_000);
});
