/**
 * Who last saved a draft.
 *
 * Drafts are reviewed by whoever is free, so the attribution has to name the person who
 * actually saved last — not the one who read the invoice in, and not whoever happens to be
 * looking. These drive the real server action against a real database, with `actionSession()`
 * mocked the way `draft-review.integration.test.ts` does.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn() }));

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("draft last-saved attribution (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenseDrafts, expenseImports, lineItems, organizations, paymentSources, users } = await import(
    "@/src/db/schema"
  );
  const { createTestOrg } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { actionSession } = await import("@/src/lib/action-session");
  const { updateDraftAction } = await import("./draft-actions");
  const { loadMonthDrafts, loadDraftById } = await import("./queries");

  const session = vi.mocked(actionSession);

  let orgId: string;
  let fundingSourceId: string;
  let lineItemId: string;
  let importId: string;
  /** The person who read the invoice in. */
  let authorId: string;
  /** A second reviewer in the same organisation. */
  let reviewerId: string;

  const MONTH = "2098-04";

  async function insertUser(name: string | null) {
    const [row] = await db
      .insert(users)
      .values({
        orgId,
        email: `draft-attr-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
        name,
        passwordHash: await hashPassword("original-password-here"),
        role: "admin",
      })
      .returning({ id: users.id });
    return row.id;
  }

  function asUser(userId: string) {
    session.mockResolvedValue({
      orgId,
      userId,
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

  let sortCounter = 0;
  async function insertDraft(createdBy: string | null) {
    const [row] = await db
      .insert(expenseDrafts)
      .values({
        importId,
        orgId,
        fundingSourceId,
        month: MONTH,
        date: `${MONTH}-10`,
        name: "Draft vendor",
        paymentSource: "Operating account",
        subtotalCents: 5000,
        lineItemId,
        narrative: "Ready to approve.",
        sortOrder: sortCounter++,
        createdByUserId: createdBy,
        updatedByUserId: createdBy,
      })
      .returning({ id: expenseDrafts.id });
    return row.id;
  }

  /** The form payload `updateDraftAction` takes, with only the id varying per test. */
  function editFor(id: string, name: string) {
    return {
      id,
      name,
      fundingSourceId,
      lineItemId,
      paymentSource: "Operating account",
      month: MONTH,
      date: `${MONTH}-10`,
      description: "",
      subtotal: "50.00",
      tax: "0.00",
      fees: "0.00",
      taxReimbursable: false,
      feesReimbursable: true,
      note: "",
      narrative: "Ready to approve.",
      noReceipt: false,
      noReceiptReason: "",
    };
  }

  beforeAll(async () => {
    const org = await createTestOrg({
      name: "Draft Attribution Org",
      docName: "Attr",
      activeMonth: MONTH,
    });
    orgId = org.orgId;
    fundingSourceId = org.fundingSourceId;

    const [item] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name: "Supplies", scheduledValueCents: 500_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemId = item.id;

    await db.insert(paymentSources).values({ orgId, label: "Operating account", sortOrder: 0 });

    const [imported] = await db
      .insert(expenseImports)
      .values({
        orgId,
        fundingSourceId,
        month: MONTH,
        s3Key: `test/${uuidv7()}.pdf`,
        filename: "invoice.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        pageCount: 1,
        sha256: uuidv7().replace(/-/g, "").padEnd(64, "0"),
      })
      .returning({ id: expenseImports.id });
    importId = imported.id;

    authorId = await insertUser("Ada Author");
    reviewerId = await insertUser("Rory Reviewer");
  });

  // Every row here hangs off this organisation and goes with it; the files under its
  // storage prefix do not, so those are removed by hand.
  afterAll(async () => {
    const { rm } = await import("node:fs/promises");
    const path = await import("node:path");
    for (const id of [orgId]) {
      if (!id) continue;
      await db.delete(organizations).where(eq(organizations.id, id));
      await rm(path.join(process.cwd(), ".storage", "org", id), { recursive: true, force: true });
    }
  });

  it("records the editor, not the person who created the draft", async () => {
    const id = await insertDraft(authorId);

    asUser(reviewerId);
    expect((await updateDraftAction(editFor(id, "Edited by Rory"))).ok).toBe(true);

    const [row] = await db.select().from(expenseDrafts).where(eq(expenseDrafts.id, id));
    // The author is who it came from; the reviewer is who touched it last. Conflating the two
    // is the whole failure this guards: a second reviewer would be told the draft was last
    // handled by the person who merely imported it.
    expect(row.createdByUserId).toBe(authorId);
    expect(row.updatedByUserId).toBe(reviewerId);
  });

  it("names the last editor on the review list", async () => {
    const id = await insertDraft(authorId);

    asUser(reviewerId);
    await updateDraftAction(editFor(id, "Listed draft"));

    const rows = await loadMonthDrafts(orgId, fundingSourceId, MONTH);
    const row = rows.find((candidate) => candidate.id === id);
    expect(row?.lastSavedBy).toBe("Rory Reviewer");
  });

  it("names the last editor on the draft's own screen", async () => {
    const id = await insertDraft(authorId);

    asUser(reviewerId);
    await updateDraftAction(editFor(id, "Opened draft"));

    expect((await loadDraftById(orgId, id))?.lastSavedBy).toBe("Rory Reviewer");
  });

  it("says nothing for a draft saved before the column existed", async () => {
    // Exactly the shape of every row already in the database when this shipped: the migration
    // added the column nullable and backfilled nothing, so the screens must stay quiet rather
    // than attribute those drafts to nobody, or to whoever is looking.
    const id = await insertDraft(null);

    const rows = await loadMonthDrafts(orgId, fundingSourceId, MONTH);
    expect(rows.find((candidate) => candidate.id === id)?.lastSavedBy).toBeNull();
    expect((await loadDraftById(orgId, id))?.lastSavedBy).toBeNull();
  });

  it("falls back to the email when the editor has no name on file", async () => {
    const namelessId = await insertUser(null);
    const [nameless] = await db.select().from(users).where(eq(users.id, namelessId));
    const id = await insertDraft(authorId);

    asUser(namelessId);
    await updateDraftAction(editFor(id, "Saved by a nameless account"));

    const rows = await loadMonthDrafts(orgId, fundingSourceId, MONTH);
    expect(rows.find((candidate) => candidate.id === id)?.lastSavedBy).toBe(nameless.email);
  });
});
