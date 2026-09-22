/**
 * `approveDraftAction` (Phase 14 §5) had no test of its own before this file (checked with grep
 * first). Modelled on `draft-review.integration.test.ts`'s own setup/session pattern.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn() }));

config({ path: ".env.local", quiet: true });

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("approveDraftAction (integration)", async () => {
  const { db } = await import("@/src/db");
  const {
    expenseAuditEvents,
    expenseDrafts,
    expenseImports,
    expenses,
    fundingSources,
    lineItems,
    monthStatuses,
    organizations,
    users,
  } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { actionSession } = await import("@/src/lib/action-session");
  const { approveDraftAction } = await import("./draft-actions");
  const { UI } = await import("@/src/domain/strings");
  const { monthLabel } = await import("@/src/domain/dates");

  const session = vi.mocked(actionSession);

  const MONTH = "2099-08";

  let orgId: string;
  let fundingSourceId: string;
  let lineItemId: string;
  let importId: string;
  let userId: string;

  let otherOrgId: string;
  let otherUserId: string;

  beforeAll(async () => {
    const org = await createTestOrg({ name: "Approve Org", docName: "Approve", activeMonth: MONTH });
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
        month: MONTH,
        s3Key: `test/approve-${Date.now()}.pdf`,
        filename: "invoice.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        pageCount: 1,
        sha256: "a".repeat(64),
      })
      .returning({ id: expenseImports.id });
    importId = imported.id;

    const [user] = await db
      .insert(users)
      .values({
        orgId,
        email: `approve-${Date.now()}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
        role: "admin",
      })
      .returning({ id: users.id });
    userId = user.id;

    const other = await createTestOrg({ name: "Approve Other Org", docName: "Other", activeMonth: MONTH });
    otherOrgId = other.orgId;
    const [otherUser] = await db
      .insert(users)
      .values({
        orgId: otherOrgId,
        email: `approve-other-${Date.now()}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
        role: "admin",
      })
      .returning({ id: users.id });
    otherUserId = otherUser.id;
  });

  afterAll(async () => {
    for (const id of [orgId, otherOrgId]) {
      if (id) await db.delete(organizations).where(eq(organizations.id, id));
    }
  });

  function asOrg(org: string, user: string) {
    session.mockResolvedValue({
      orgId: org,
      userId: user,
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
    narrative?: string | null;
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
        narrative: overrides.narrative === undefined ? "Ready to approve." : overrides.narrative,
        sortOrder: sortCounter++,
      })
      .returning({ id: expenseDrafts.id });
    return row.id;
  }

  async function draftById(id: string) {
    const [row] = await db.select().from(expenseDrafts).where(eq(expenseDrafts.id, id));
    return row ?? null;
  }

  async function unlockMonth(fsId: string, month: string) {
    await db
      .update(monthStatuses)
      .set({ lockedAt: null })
      .where(
        and(
          eq(monthStatuses.orgId, orgId),
          eq(monthStatuses.fundingSourceId, fsId),
          eq(monthStatuses.month, month),
        ),
      );
  }

  it("happy path: one expense with a reference number, the draft gone, an audit event with fromInvoice", async () => {
    asOrg(orgId, userId);
    const id = await insertDraft({ orgId, fundingSourceId, lineItemId, importId, name: "Happy Vendor" });

    const result = await approveDraftAction(id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const [expense] = await db.select().from(expenses).where(eq(expenses.id, result.data.id));
    expect(expense).toBeDefined();
    expect(expense.referenceSeq).toBeGreaterThanOrEqual(1);
    expect(expense.orgId).toBe(orgId);

    expect(await draftById(id)).toBeNull();

    const events = await db
      .select()
      .from(expenseAuditEvents)
      .where(eq(expenseAuditEvents.expenseId, expense.id));
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("created");
    expect((events[0].afterData as Record<string, unknown>).fromInvoice).toBe(true);
  });

  it("a locked month refuses with the exact UI.monthLocked message and writes no expense", async () => {
    asOrg(orgId, userId);
    const id = await insertDraft({ orgId, fundingSourceId, lineItemId, importId, name: "Locked Vendor" });

    await db
      .insert(monthStatuses)
      .values({ orgId, fundingSourceId, month: MONTH, lockedAt: new Date() })
      .onConflictDoUpdate({
        target: [monthStatuses.orgId, monthStatuses.fundingSourceId, monthStatuses.month],
        set: { lockedAt: new Date() },
      });

    try {
      const before = await db.select().from(expenses).where(eq(expenses.orgId, orgId));
      const result = await approveDraftAction(id);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error).toBe(UI.monthLocked(monthLabel(MONTH)));

      const after = await db.select().from(expenses).where(eq(expenses.orgId, orgId));
      expect(after).toHaveLength(before.length);
      expect(await draftById(id)).not.toBeNull();
    } finally {
      await unlockMonth(fundingSourceId, MONTH);
    }
  });

  it("an archived funding source refuses, and writes no expense", async () => {
    asOrg(orgId, userId);
    const id = await insertDraft({ orgId, fundingSourceId, lineItemId, importId, name: "Archived Vendor" });

    await db.update(fundingSources).set({ archivedAt: new Date() }).where(eq(fundingSources.id, fundingSourceId));
    try {
      const result = await approveDraftAction(id);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error).toBe(
        "That funding source is archived. Unarchive it in Settings to add expenses to it.",
      );
      expect(await draftById(id)).not.toBeNull();
    } finally {
      await db.update(fundingSources).set({ archivedAt: null }).where(eq(fundingSources.id, fundingSourceId));
    }
  });

  it("a deleted line item (FK nulls lineItemId) refuses with UI.draftNotReady", async () => {
    asOrg(orgId, userId);
    const [tempItem] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name: "Temp Item", scheduledValueCents: 1000, sortOrder: 5 })
      .returning({ id: lineItems.id });

    const id = await insertDraft({
      orgId,
      fundingSourceId,
      lineItemId: tempItem.id,
      importId,
      name: "Orphaned Line Item Vendor",
    });

    // The FK sets lineItemId null on delete (schema.ts) rather than blocking the delete.
    await db.delete(lineItems).where(eq(lineItems.id, tempItem.id));
    expect((await draftById(id))?.lineItemId).toBeNull();

    const result = await approveDraftAction(id);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe(UI.draftNotReady);
    expect(await draftById(id)).not.toBeNull();
  });

  it("a null narrative refuses with UI.draftNotReady", async () => {
    asOrg(orgId, userId);
    const id = await insertDraft({
      orgId,
      fundingSourceId,
      lineItemId,
      importId,
      name: "No Narrative Vendor",
      narrative: null,
    });

    const result = await approveDraftAction(id);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe(UI.draftNotReady);
    expect(await draftById(id)).not.toBeNull();
  });

  it("another org's session cannot approve: UI.draftGone, and the draft still exists", async () => {
    asOrg(orgId, userId);
    const id = await insertDraft({ orgId, fundingSourceId, lineItemId, importId, name: "Cross-Org Vendor" });

    asOrg(otherOrgId, otherUserId);
    const result = await approveDraftAction(id);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe(UI.draftGone);
    expect(await draftById(id)).not.toBeNull();
  });
});
