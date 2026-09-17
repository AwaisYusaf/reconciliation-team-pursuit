/**
 * â˜… Packet-pipeline isolation (Phase 6, D-93) â€” the acceptance criteria from Appendix A of
 * `docs/PHASE-6.md`: "Outputs per source, never mixed", "a missing receipt on the foundation
 * grant does not block the City packet", and "marking a month Submitted is per source per
 * month". Exercised through the actual functions the download routes and packet screen call
 * (`loadMonthSnapshot`, `loadPacketReadiness`, `markMonthSubmittedAction`), not just the raw
 * query layer Phase 2/5 already proved isolated.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn() }));

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("packet pipeline isolation across funding sources (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenses, fundingSources, lineItems, organizations } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { claimReferenceSeq } = await import("@/src/modules/expenses/references");
  const { ingestExpenseDocument, ingestMonthDocument } = await import(
    "@/src/services/storage/documents"
  );
  const { loadMonthSnapshot } = await import("@/src/generation/month-snapshot");
  const { loadPacketReadiness } = await import("./queries");
  const { markMonthSubmittedAction } = await import("./actions");
  const { actionSession } = await import("@/src/lib/action-session");

  const session = vi.mocked(actionSession);
  const MONTH = "2096-04";

  let orgId: string;
  let sourceA: string;
  let sourceB: string;
  let itemA: string;
  let itemB: string;
  let expenseA: string;
  let expenseB: string;

  function asOrg(orgId: string) {
    session.mockResolvedValue({
      orgId,
      userId: "u",
      email: "e@example.com",
      role: "admin",
      orgName: "Org",
      docName: "Doc",
      activeMonth: MONTH,
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
      plan: "reconciliation" as const,
    });
  }

  beforeAll(async () => {
    const org = await createTestOrg({ name: "Packet Isolation Org", activeMonth: MONTH });
    orgId = org.orgId;
    sourceA = org.fundingSourceId;

    const [b] = await db
      .insert(fundingSources)
      .values({
        orgId,
        name: "Source B",
        type: "donation",
        sortOrder: 1,
        taxReimbursable: false,
        feesReimbursable: true,
      })
      .returning({ id: fundingSources.id });
    sourceB = b.id;

    const [ia] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId: sourceA, name: "A's item", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    itemA = ia.id;

    const [ib] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId: sourceB, name: "B's item", scheduledValueCents: 100_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    itemB = ib.id;

    // Source A: a fully documented, non-blocking expense.
    const [ea] = await db
      .insert(expenses)
      .values({
        orgId,
        fundingSourceId: sourceA,
        lineItemId: itemA,
        month: MONTH,
        date: `${MONTH}-05`,
        name: "A's expense",
        narrative: "A narrative.",
        paymentSource: "x",
        subtotalCents: 1_000,
        taxReimbursable: false,
        feesReimbursable: true,
        sortOrder: 0,
        referenceSeq: await claimReferenceSeq(orgId, sourceA, MONTH),
      })
      .returning({ id: expenses.id });
    expenseA = ea.id;

    // Source B: an expense missing its receipt â€” must block B without touching A.
    const [eb] = await db
      .insert(expenses)
      .values({
        orgId,
        fundingSourceId: sourceB,
        lineItemId: itemB,
        month: MONTH,
        date: `${MONTH}-06`,
        name: "B's expense",
        narrative: "B narrative.",
        paymentSource: "x",
        subtotalCents: 2_000,
        taxReimbursable: false,
        feesReimbursable: true,
        sortOrder: 0,
        referenceSeq: await claimReferenceSeq(orgId, sourceB, MONTH),
      })
      .returning({ id: expenses.id });
    expenseB = eb.id;

    const jpeg = await sharp({
      create: { width: 300, height: 400, channels: 3, background: { r: 250, g: 250, b: 248 } },
    })
      .jpeg()
      .toBuffer();

    const proof = await ingestExpenseDocument({
      orgId,
      expenseId: expenseA,
      scope: "proof",
      file: new File([new Uint8Array(jpeg)], "proof.jpg", { type: "image/jpeg" }),
    });
    if (!proof.ok) throw new Error(proof.error);
    const receipt = await ingestExpenseDocument({
      orgId,
      expenseId: expenseA,
      scope: "receipt",
      file: new File([new Uint8Array(jpeg)], "receipt.jpg", { type: "image/jpeg" }),
    });
    if (!receipt.ok) throw new Error(receipt.error);
    // B gets a proof but no receipt â€” the specific gap that must block B alone.
    const proofB = await ingestExpenseDocument({
      orgId,
      expenseId: expenseB,
      scope: "proof",
      file: new File([new Uint8Array(jpeg)], "proof-b.jpg", { type: "image/jpeg" }),
    });
    if (!proofB.ok) throw new Error(proofB.error);

    // A month document attached only to source A.
    const monthDoc = await ingestMonthDocument({
      orgId,
      fundingSourceId: sourceA,
      month: MONTH,
      category: "bank_statement",
      title: "A's statement",
      file: new File([new Uint8Array(jpeg)], "statement.jpg", { type: "image/jpeg" }),
    });
    if (!monthDoc.ok) throw new Error(monthDoc.error);
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("â˜… each source's snapshot contains none of the other's expenses, line items or month documents", async () => {
    const snapshotA = await loadMonthSnapshot(orgId, sourceA, MONTH);
    expect(snapshotA.lineItems.map((i) => i.id)).toEqual([itemA]);
    expect(snapshotA.expenses.map((e) => e.id)).toEqual([expenseA]);
    expect(snapshotA.monthDocuments.map((d) => d.title)).toEqual(["A's statement"]);

    const snapshotB = await loadMonthSnapshot(orgId, sourceB, MONTH);
    expect(snapshotB.lineItems.map((i) => i.id)).toEqual([itemB]);
    expect(snapshotB.expenses.map((e) => e.id)).toEqual([expenseB]);
    expect(snapshotB.monthDocuments).toEqual([]);
  });

  it("a missing receipt on source B does not block source A's packet route", async () => {
    const readinessA = await loadPacketReadiness(orgId, sourceA, MONTH);
    expect(readinessA.blocking).toEqual([]);

    const readinessB = await loadPacketReadiness(orgId, sourceB, MONTH);
    expect(readinessB.blocking.length).toBeGreaterThan(0);
    expect(readinessB.blocking.map((row) => row.expenseId)).toContain(expenseB);
  });

  it("submitting source A does not mark source B as submitted", async () => {
    asOrg(orgId);
    const result = await markMonthSubmittedAction(MONTH, sourceA);
    expect(result.ok).toBe(true);

    const readinessA = await loadPacketReadiness(orgId, sourceA, MONTH);
    expect(readinessA.submittedAt).not.toBeNull();

    const readinessB = await loadPacketReadiness(orgId, sourceB, MONTH);
    expect(readinessB.submittedAt).toBeNull();
  });
});
