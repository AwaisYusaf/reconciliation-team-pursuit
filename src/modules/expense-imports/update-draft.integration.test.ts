/**
 * `updateDraftAction` (Phase 14 §5) had no test of its own before this file (checked with grep
 * first). Modelled on `approve.integration.test.ts`'s own setup/session pattern.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn() }));

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("updateDraftAction (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenseDrafts, expenseImports, expenses, lineItems, organizations, paymentSources, users } =
    await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { actionSession } = await import("@/src/lib/action-session");
  const { updateDraftAction } = await import("./draft-actions");
  const { UI } = await import("@/src/domain/strings");

  const session = vi.mocked(actionSession);

  const MONTH = "2099-06";

  let orgId: string;
  let fundingSourceId: string;
  let lineItemId: string;
  let importId: string;
  let userId: string;

  // A second funding source in the SAME org, with its own line item — for the
  // "line item belongs to a different funding source" case.
  let otherSourceId: string;
  let otherSourceLineItemId: string;

  let otherOrgId: string;
  let otherOrgUserId: string;

  beforeAll(async () => {
    const org = await createTestOrg({ name: "Update Draft Org", docName: "UpdateDraft", activeMonth: MONTH });
    orgId = org.orgId;
    fundingSourceId = org.fundingSourceId;

    const [item] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name: "Supplies", scheduledValueCents: 500_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemId = item.id;

    await db.insert(paymentSources).values({ orgId, label: "Operating account", sortOrder: 0 });

    const { ORIGINAL_RULES } = await import("@/src/modules/expenses/reimbursement");
    const [source2] = await db
      .insert((await import("@/src/db/schema")).fundingSources)
      .values({ orgId, name: "Source 2", type: "grant", sortOrder: 1, ...ORIGINAL_RULES })
      .returning({ id: (await import("@/src/db/schema")).fundingSources.id });
    otherSourceId = source2.id;

    const [item2] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId: otherSourceId, name: "Other Source Item", scheduledValueCents: 1000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    otherSourceLineItemId = item2.id;

    const [imported] = await db
      .insert(expenseImports)
      .values({
        orgId,
        fundingSourceId,
        month: MONTH,
        s3Key: `test/update-draft-${Date.now()}.pdf`,
        filename: "invoice.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        pageCount: 1,
        sha256: "c".repeat(64),
      })
      .returning({ id: expenseImports.id });
    importId = imported.id;

    const [user] = await db
      .insert(users)
      .values({
        orgId,
        email: `update-draft-${Date.now()}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
        role: "admin",
      })
      .returning({ id: users.id });
    userId = user.id;

    const other = await createTestOrg({ name: "Update Draft Other Org", docName: "Other", activeMonth: MONTH });
    otherOrgId = other.orgId;
    const [otherUser] = await db
      .insert(users)
      .values({
        orgId: otherOrgId,
        email: `update-draft-other-${Date.now()}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
        role: "admin",
      })
      .returning({ id: users.id });
    otherOrgUserId = otherUser.id;
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
  async function insertDraft(name = "Draft vendor") {
    const [row] = await db
      .insert(expenseDrafts)
      .values({
        importId,
        orgId,
        fundingSourceId,
        month: MONTH,
        date: `${MONTH}-10`,
        name,
        paymentSource: "Operating account",
        subtotalCents: 5000,
        lineItemId,
        narrative: "Started out ready.",
        sortOrder: sortCounter++,
      })
      .returning({ id: expenseDrafts.id });
    return row.id;
  }

  async function draftById(id: string) {
    const [row] = await db.select().from(expenseDrafts).where(eq(expenseDrafts.id, id));
    return row ?? null;
  }

  /** A valid draft-mode input for `id`: `fundingSourceId` is shape-checked by `validate` but
   *  never used to move the draft (the action re-reads its own source from the row). */
  function baseInput(id: string, overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id,
      name: "Edited name",
      fundingSourceId,
      lineItemId,
      paymentSource: "Operating account",
      taxReimbursable: false,
      feesReimbursable: true,
      month: MONTH,
      date: `${MONTH}-12`,
      description: "Edited description",
      subtotal: "60.00",
      tax: "1.00",
      fees: "0.50",
      note: "",
      narrative: "Edited narrative.",
      noReceipt: false,
      noReceiptReason: "",
      ...overrides,
    } as Parameters<typeof updateDraftAction>[0];
  }

  it("a save writes to expense_drafts and creates no expenses row", async () => {
    asOrg(orgId, userId);
    const id = await insertDraft("Save Target");
    const beforeExpenseCount = (await db.select().from(expenses).where(eq(expenses.orgId, orgId))).length;

    const result = await updateDraftAction(baseInput(id, { name: "Save Target Edited" }));
    expect(result.ok).toBe(true);

    const draft = await draftById(id);
    expect(draft?.name).toBe("Save Target Edited");
    expect(draft?.description).toBe("Edited description");
    expect(draft?.subtotalCents).toBe(6000);

    const afterExpenseCount = (await db.select().from(expenses).where(eq(expenses.orgId, orgId))).length;
    expect(afterExpenseCount).toBe(beforeExpenseCount);
  });

  it("another org's session gets UI.draftGone, and the row is unchanged", async () => {
    asOrg(orgId, userId);
    const id = await insertDraft("Cross-Org Target");
    const before = await draftById(id);

    asOrg(otherOrgId, otherOrgUserId);
    const result = await updateDraftAction(baseInput(id, { name: "Hijacked" }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe(UI.draftGone);

    const after = await draftById(id);
    expect(after).toEqual(before);
  });

  it("a lineItemId belonging to a second funding source is refused with 'Choose a line item.'", async () => {
    asOrg(orgId, userId);
    const id = await insertDraft("Cross-Source Target");

    const result = await updateDraftAction(baseInput(id, { lineItemId: otherSourceLineItemId }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("Choose a line item.");
  });

  it("an unknown paymentSource is refused with 'Choose a payment source.'", async () => {
    asOrg(orgId, userId);
    const id = await insertDraft("Unknown Payment Source Target");

    const result = await updateDraftAction(baseInput(id, { paymentSource: "Not a real payment source" }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("Choose a payment source.");
  });

  it("a non-UUID lineItemId returns 'Choose a line item.' rather than throwing", async () => {
    asOrg(orgId, userId);
    const id = await insertDraft("Non-UUID Line Item Target");

    // Would raise a Postgres 22P02 (invalid input syntax for type uuid) without the guard —
    // proving the guard is what turns that into a clean refusal rather than a thrown error.
    const call = updateDraftAction(baseInput(id, { lineItemId: "not-a-uuid" }));
    await expect(call).resolves.not.toThrow();

    const result = await call;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("Choose a line item.");
  });
});
