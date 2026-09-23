/**
 * Discard / undo for a review draft (Phase 14 final phase), and the cheap `loadDraftById` scoping
 * checks. Neither `discardDraftAction` nor `undoDiscardAction` had a test before this file (see
 * the phase's own report — checked with grep first).
 *
 * Drives the real server actions against a real database, `actionSession()` mocked exactly the
 * way `src/modules/expenses/expenses-trash.integration.test.ts` does.
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

describe.skipIf(!hasDatabase)("draft discard / undo (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenseDraftDocuments, expenseDrafts, expenseImports, lineItems, organizations, paymentSources, users } =
    await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { actionSession } = await import("@/src/lib/action-session");
  const { discardDraftAction, undoDiscardAction } = await import("./draft-actions");
  const { loadDraftById } = await import("./queries");

  const session = vi.mocked(actionSession);

  let orgId: string;
  let fundingSourceId: string;
  let lineItemId: string;
  let otherOrgId: string;
  let userId: string;
  let otherUserId: string;

  const MONTH = "2099-09";

  async function insertUser(orgId: string) {
    const [row] = await db
      .insert(users)
      .values({
        orgId,
        email: `draft-review-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
        role: "admin",
      })
      .returning({ id: users.id });
    return row.id;
  }

  function asOrg(id: string) {
    session.mockResolvedValue({
      orgId: id,
      userId: id === otherOrgId ? otherUserId : userId,
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
  async function insertDraft(overrides: {
    orgId: string;
    fundingSourceId: string;
    lineItemId: string | null;
    importId: string;
    name?: string;
  }) {
    const [row] = await db
      .insert(expenseDrafts)
      .values({
        importId: overrides.importId,
        orgId: overrides.orgId,
        fundingSourceId: overrides.fundingSourceId,
        month: MONTH,
        date: `${MONTH}-10`,
        name: overrides.name ?? "Draft vendor",
        paymentSource: "Operating account",
        subtotalCents: 5000,
        lineItemId: overrides.lineItemId,
        narrative: "Ready to approve.",
        sortOrder: sortCounter++,
      })
      .returning({ id: expenseDrafts.id });
    return row.id;
  }

  async function insertImport(orgId: string, fundingSourceId: string) {
    const [row] = await db
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
    return row.id;
  }

  async function draftById(id: string) {
    const [row] = await db.select().from(expenseDrafts).where(eq(expenseDrafts.id, id));
    return row ?? null;
  }

  beforeAll(async () => {
    const org = await createTestOrg({ name: "Draft Review Org", docName: "Review", activeMonth: MONTH });
    orgId = org.orgId;
    fundingSourceId = org.fundingSourceId;

    const [item] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name: "Supplies", scheduledValueCents: 500_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemId = item.id;

    await db.insert(paymentSources).values({ orgId, label: "Operating account", sortOrder: 0 });

    const other = await createTestOrg({ name: "Other Draft Org", docName: "Other", activeMonth: MONTH });
    otherOrgId = other.orgId;

    userId = await insertUser(orgId);
    otherUserId = await insertUser(otherOrgId);
  });

  afterAll(async () => {
    for (const id of [orgId, otherOrgId]) {
      if (id) await db.delete(organizations).where(eq(organizations.id, id));
    }
  });

  describe("discard then undo", () => {
    it("removes the row on discard, and undo restores it with the SAME id", async () => {
      asOrg(orgId);
      const importId = await insertImport(orgId, fundingSourceId);
      const id = await insertDraft({ orgId, fundingSourceId, lineItemId, importId, name: "Restore me" });

      const discardResult = await discardDraftAction(id);
      expect(discardResult.ok).toBe(true);
      expect(await draftById(id)).toBeNull();

      if (!discardResult.ok) throw new Error("unreachable");
      const undoResult = await undoDiscardAction(discardResult.data);
      expect(undoResult.ok).toBe(true);

      const restored = await draftById(id);
      expect(restored).not.toBeNull();
      expect(restored!.id).toBe(id);
      expect(restored!.name).toBe("Restore me");
    });

    it("fails cleanly on a bogus (non-UUID) id rather than throwing/500ing", async () => {
      asOrg(orgId);
      const result = await discardDraftAction("not-a-uuid");
      expect(result.ok).toBe(false);
    });

    it("fails on discarding an already-gone draft", async () => {
      asOrg(orgId);
      const importId = await insertImport(orgId, fundingSourceId);
      const id = await insertDraft({ orgId, fundingSourceId, lineItemId, importId });
      await discardDraftAction(id);

      const second = await discardDraftAction(id);
      expect(second.ok).toBe(false);
    });

    it("undo of a draft whose import no longer exists fails instead of resurrecting it", async () => {
      asOrg(orgId);
      const importId = await insertImport(orgId, fundingSourceId);
      const id = await insertDraft({ orgId, fundingSourceId, lineItemId, importId, name: "Import gone" });

      const discardResult = await discardDraftAction(id);
      expect(discardResult.ok).toBe(true);
      if (!discardResult.ok) throw new Error("unreachable");

      // The import itself is deleted before the undo runs.
      await db.delete(expenseImports).where(eq(expenseImports.id, importId));

      const undoResult = await undoDiscardAction(discardResult.data);
      expect(undoResult.ok).toBe(false);
      expect(await draftById(id)).toBeNull();
    });

    it("undo of a draft whose funding source no longer exists fails instead of resurrecting it", async () => {
      const tempOrg = await createTestOrg({ name: "Temp Source Org", docName: "Temp", activeMonth: MONTH });
      asOrg(tempOrg.orgId);
      const tempUserId = await insertUser(tempOrg.orgId);
      session.mockResolvedValue({
        orgId: tempOrg.orgId,
        userId: tempUserId,
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

      const importId = await insertImport(tempOrg.orgId, tempOrg.fundingSourceId);
      const id = await insertDraft({
        orgId: tempOrg.orgId,
        fundingSourceId: tempOrg.fundingSourceId,
        lineItemId: null,
        importId,
        name: "Source gone",
      });

      const discardResult = await discardDraftAction(id);
      expect(discardResult.ok).toBe(true);
      if (!discardResult.ok) throw new Error("unreachable");

      // Deleting the org cascades away its funding source too.
      await db.delete(organizations).where(eq(organizations.id, tempOrg.orgId));

      const undoResult = await undoDiscardAction(discardResult.data);
      expect(undoResult.ok).toBe(false);
    });

    it("org B cannot discard org A's draft", async () => {
      asOrg(orgId);
      const importId = await insertImport(orgId, fundingSourceId);
      const id = await insertDraft({ orgId, fundingSourceId, lineItemId, importId });

      asOrg(otherOrgId);
      const result = await discardDraftAction(id);
      expect(result.ok).toBe(false);
      expect(await draftById(id)).not.toBeNull();
    });

    it("undo re-validates as a fresh create: another org cannot use it to plant a row in org A", async () => {
      asOrg(orgId);
      const importId = await insertImport(orgId, fundingSourceId);
      const id = await insertDraft({ orgId, fundingSourceId, lineItemId, importId, name: "Stolen payload" });
      const discardResult = await discardDraftAction(id);
      expect(discardResult.ok).toBe(true);
      if (!discardResult.ok) throw new Error("unreachable");

      // Org B tries to replay org A's discarded-draft payload as its own undo.
      asOrg(otherOrgId);
      const result = await undoDiscardAction(discardResult.data);
      expect(result.ok).toBe(false);
      expect(await draftById(id)).toBeNull();
    });
  });

  describe("regression: discardDraftAction reports and cleans up attached files", () => {
    it("returns removedFileCount and deletes the expense_draft_documents row", async () => {
      asOrg(orgId);
      const importId = await insertImport(orgId, fundingSourceId);
      const id = await insertDraft({ orgId, fundingSourceId, lineItemId, importId, name: "Has a file" });

      const [doc] = await db
        .insert(expenseDraftDocuments)
        .values({
          orgId,
          draftId: id,
          kind: "receipt",
          status: "attached",
          s3Key: `test/discard-doc-${uuidv7()}`,
          filename: "receipt.png",
          mimeType: "image/png",
          sizeBytes: 100,
          sortOrder: 0,
        })
        .returning({ id: expenseDraftDocuments.id });

      const result = await discardDraftAction(id);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data.removedFileCount).toBe(1);

      const remaining = await db
        .select()
        .from(expenseDraftDocuments)
        .where(eq(expenseDraftDocuments.id, doc.id));
      expect(remaining).toHaveLength(0);
    });

    it("returns removedFileCount 0 for a draft with no attached files", async () => {
      asOrg(orgId);
      const importId = await insertImport(orgId, fundingSourceId);
      const id = await insertDraft({ orgId, fundingSourceId, lineItemId, importId, name: "No files" });

      const result = await discardDraftAction(id);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data.removedFileCount).toBe(0);
    });
  });

  describe("loadDraftById", () => {
    it("returns undefined for a non-UUID id", async () => {
      expect(await loadDraftById(orgId, "not-a-uuid")).toBeUndefined();
    });

    it("returns undefined for another org's draft (org-scoped)", async () => {
      const importId = await insertImport(orgId, fundingSourceId);
      const id = await insertDraft({ orgId, fundingSourceId, lineItemId, importId });

      expect(await loadDraftById(otherOrgId, id)).toBeUndefined();
      expect(await loadDraftById(orgId, id)).not.toBeUndefined();
    });
  });

  describe("invoices nothing came of are swept, but never before Undo can run", () => {
    it("keeps an emptied import while its draft could still be undone", async () => {
      const importId = await insertImport(orgId, fundingSourceId);
      const id = await insertDraft({ orgId, fundingSourceId, lineItemId, importId });
      const discarded = await discardDraftAction(id);
      expect(discarded.ok).toBe(true);

      // Still there: `undoDiscardAction` re-inserts the draft against this very row, so
      // deleting it at the discard would make Undo fail on a foreign key.
      const [still] = await db
        .select({ id: expenseImports.id })
        .from(expenseImports)
        .where(eq(expenseImports.id, importId));
      expect(still).toBeDefined();

      if (discarded.ok) {
        expect((await undoDiscardAction(discarded.data)).ok).toBe(true);
      }
    });

    it("removes an import once its last draft is gone for good", async () => {
      const { sweepOrphanImports } = await import("./orphan-imports");

      const importId = await insertImport(orgId, fundingSourceId);
      const id = await insertDraft({ orgId, fundingSourceId, lineItemId, importId });
      const discarded = await discardDraftAction(id);
      expect(discarded.ok).toBe(true);

      // Nothing left that came from it, and no expense using its file.
      const swept = await sweepOrphanImports(orgId);
      expect(swept).toBeGreaterThan(0);

      const rows = await db
        .select({ id: expenseImports.id })
        .from(expenseImports)
        .where(eq(expenseImports.id, importId));
      expect(rows).toHaveLength(0);
    });
  });
});
