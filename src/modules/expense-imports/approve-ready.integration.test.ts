/**
 * `approveReadyDraftsAction` (Phase 14 §5) had no test of its own before this file (checked
 * with grep first). Modelled on `approve.integration.test.ts`'s own setup/session pattern.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn() }));

config({ path: ".env.local", quiet: true });

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("approveReadyDraftsAction (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenseDrafts, expenseImports, expenses, fundingSources, lineItems, monthStatuses, organizations, users } =
    await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { actionSession } = await import("@/src/lib/action-session");
  const { approveReadyDraftsAction } = await import("./draft-actions");
  const { UI } = await import("@/src/domain/strings");

  const session = vi.mocked(actionSession);

  const MONTH = "2099-10";

  let orgId: string;
  let fundingSourceId: string;
  let lineItemId: string;
  let importId: string;
  let userId: string;

  beforeAll(async () => {
    const org = await createTestOrg({ name: "Approve Ready Org", docName: "ApproveReady", activeMonth: MONTH });
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
        s3Key: `test/approve-ready-${Date.now()}.pdf`,
        filename: "invoice.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        pageCount: 1,
        sha256: "b".repeat(64),
      })
      .returning({ id: expenseImports.id });
    importId = imported.id;

    const [user] = await db
      .insert(users)
      .values({
        orgId,
        email: `approve-ready-${Date.now()}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
        role: "admin",
      })
      .returning({ id: users.id });
    userId = user.id;
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  function asOrg() {
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
  async function insertDraft(overrides: {
    ready: boolean;
    name: string;
  }) {
    const [row] = await db
      .insert(expenseDrafts)
      .values({
        importId,
        orgId,
        fundingSourceId,
        month: MONTH,
        date: `${MONTH}-10`,
        name: overrides.name,
        paymentSource: "Operating account",
        subtotalCents: 5000,
        lineItemId: overrides.ready ? lineItemId : null,
        narrative: overrides.ready ? "Ready to approve." : null,
        sortOrder: sortCounter++,
      })
      .returning({ id: expenseDrafts.id });
    return row.id;
  }

  async function nextReferenceSeq(): Promise<number> {
    const [row] = await db
      .select({ next: monthStatuses.nextReferenceSeq })
      .from(monthStatuses)
      .where(
        sql`${monthStatuses.orgId} = ${orgId} and ${monthStatuses.fundingSourceId} = ${fundingSourceId} and ${monthStatuses.month} = ${MONTH}`,
      );
    return row?.next ?? 1;
  }

  it("approves exactly the ready drafts in the batch, leaves the unready ones, advances the reference counter by exactly the number approved", async () => {
    asOrg();
    const before = await nextReferenceSeq();

    for (let i = 0; i < 3; i++) await insertDraft({ ready: true, name: `Ready ${i}` });
    for (let i = 0; i < 2; i++) await insertDraft({ ready: false, name: `Unready ${i}` });

    const result = await approveReadyDraftsAction({ month: MONTH, fundingSourceId });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.message).toBe(UI.draftsApproved(3, 2));

    const madeExpenses = await db
      .select()
      .from(expenses)
      .where(and(eq(expenses.orgId, orgId), eq(expenses.month, MONTH)));
    expect(madeExpenses).toHaveLength(3);

    const remainingDrafts = await db
      .select()
      .from(expenseDrafts)
      .where(and(eq(expenseDrafts.orgId, orgId), eq(expenseDrafts.month, MONTH)));
    expect(remainingDrafts).toHaveLength(2);
    expect(remainingDrafts.every((d) => d.name.startsWith("Unready"))).toBe(true);

    expect(await nextReferenceSeq()).toBe(before + 3);
  });

  it("an archived funding source refuses the whole batch before touching any draft", async () => {
    asOrg();
    const beforeDraftCount = (
      await db.select().from(expenseDrafts).where(eq(expenseDrafts.orgId, orgId))
    ).length;
    const beforeExpenseCount = (await db.select().from(expenses).where(eq(expenses.orgId, orgId))).length;

    const id1 = await insertDraft({ ready: true, name: "Batch A" });
    const id2 = await insertDraft({ ready: true, name: "Batch B" });

    await db.update(fundingSources).set({ archivedAt: new Date() }).where(eq(fundingSources.id, fundingSourceId));
    try {
      const result = await approveReadyDraftsAction({ month: MONTH, fundingSourceId });
      expect(result.ok).toBe(false);

      // Zero drafts consumed: both still present, unchanged, and no expense was created for
      // either — the whole batch refuses before it touches the first one.
      const afterDrafts = await db.select().from(expenseDrafts).where(eq(expenseDrafts.orgId, orgId));
      expect(afterDrafts).toHaveLength(beforeDraftCount + 2);
      expect(afterDrafts.map((d) => d.id)).toEqual(expect.arrayContaining([id1, id2]));

      const afterExpenses = await db.select().from(expenses).where(eq(expenses.orgId, orgId));
      expect(afterExpenses).toHaveLength(beforeExpenseCount);
    } finally {
      await db.update(fundingSources).set({ archivedAt: null }).where(eq(fundingSources.id, fundingSourceId));
    }
  });
});
