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
  const { ingestExpenseDocument, MAX_DOCUMENTS_PER_EXPENSE } = await import("./documents");

  let orgId: string;
  let expenseId: string;
  let png: Buffer;

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: "Upload Org", docName: "Upload", activeMonth: "2099-01" })
      .returning({ id: organizations.id });
    orgId = org.id;

    const [item] = await db
      .insert(lineItems)
      .values({ orgId, name: "Transportation", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });

    const [expense] = await db
      .insert(expenses)
      .values({
        orgId,
        lineItemId: item.id,
        month: "2099-01",
        date: "2099-01-05",
        name: "Rideshare",
        paymentSource: "x",
        subtotalCents: 1000,
        sortOrder: 0,
        referenceSeq: 1,
      })
      .returning({ id: expenses.id });
    expenseId = expense.id;

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

  it("never admits more than the cap, however many upload at once", async () => {
    // Twice the cap, all in flight together. Before the lock, every one of these read the
    // same count and inserted, so the expense ended up holding far more than the cap.
    const attempts = MAX_DOCUMENTS_PER_EXPENSE * 2;
    const results = await Promise.all(
      Array.from({ length: attempts }, (_, index) => upload(index)),
    );

    const accepted = results.filter((result) => result.ok).length;
    const rows = await db
      .select({ sortOrder: expenseDocuments.sortOrder })
      .from(expenseDocuments)
      .where(eq(expenseDocuments.expenseId, expenseId));

    expect(rows).toHaveLength(MAX_DOCUMENTS_PER_EXPENSE);
    expect(accepted).toBe(MAX_DOCUMENTS_PER_EXPENSE);

    // The rejected half must say why, not fail silently.
    const refusals = results.filter((result) => !result.ok);
    expect(refusals).toHaveLength(attempts - MAX_DOCUMENTS_PER_EXPENSE);
    for (const refusal of refusals) {
      expect(refusal.ok ? "" : refusal.error).toContain("at most");
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
    expect(Math.min(...orders)).toBe(0);
    expect(Math.max(...orders)).toBe(MAX_DOCUMENTS_PER_EXPENSE - 1);
  });

  it("leaves no stored object behind for a refused upload", async () => {
    // A refusal happens after the bytes are written, so the loser must take them back out.
    const { storage } = await import("./driver");
    const refused = await upload(999);
    expect(refused.ok).toBe(false);

    const stored = await db
      .select({ key: expenseDocuments.s3Key })
      .from(expenseDocuments)
      .where(and(eq(expenseDocuments.expenseId, expenseId)));
    expect(stored).toHaveLength(MAX_DOCUMENTS_PER_EXPENSE);

    for (const row of stored) expect(await storage().exists(row.key)).toBe(true);
  }, 30_000);
});
