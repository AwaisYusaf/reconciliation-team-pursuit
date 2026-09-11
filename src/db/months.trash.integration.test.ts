/**
 * `loadSelectableMonths` and soft delete.
 *
 * A month holding only trashed expenses must not be offered as selectable; restoring the
 * one expense in it must bring the month back. Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("loadSelectableMonths and trash (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenses, lineItems, organizations } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { claimReferenceSeq } = await import("@/src/modules/expenses/references");
  const { loadSelectableMonths } = await import("./months");

  let orgId: string;
  let fundingSourceId: string;
  let lineItemId: string;

  // Distinctive, far-future months so they can never collide with the "current month" window
  // `monthWindow` always includes.
  const TRASH_ONLY_MONTH = "2099-06";

  beforeAll(async () => {
    const org = await createTestOrg({
      name: "Months Trash Org",
      docName: "MonTrash",
      activeMonth: TRASH_ONLY_MONTH,
    });
    orgId = org.orgId;
    fundingSourceId = org.fundingSourceId;

    const [item] = await db
      .insert(lineItems)
      .values({ orgId, fundingSourceId, name: "Misc", scheduledValueCents: 10_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemId = item.id;
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("drops a month once its only expense is trashed, and offers it again once restored", async () => {
    const [expense] = await db
      .insert(expenses)
      .values({
        orgId,
        fundingSourceId,
        lineItemId,
        month: TRASH_ONLY_MONTH,
        date: `${TRASH_ONLY_MONTH}-10`,
        name: "Only expense this month",
        paymentSource: "x",
        subtotalCents: 1_000,
        taxReimbursable: false,
        feesReimbursable: true,
        sortOrder: 0,
        referenceSeq: await claimReferenceSeq(orgId, fundingSourceId, TRASH_ONLY_MONTH),
      })
      .returning({ id: expenses.id });

    const before = await loadSelectableMonths(orgId, fundingSourceId);
    expect(before).toContain(TRASH_ONLY_MONTH);

    await db.update(expenses).set({ deletedAt: new Date() }).where(eq(expenses.id, expense.id));

    const trashed = await loadSelectableMonths(orgId, fundingSourceId);
    expect(trashed).not.toContain(TRASH_ONLY_MONTH);

    await db.update(expenses).set({ deletedAt: null }).where(eq(expenses.id, expense.id));

    const restored = await loadSelectableMonths(orgId, fundingSourceId);
    expect(restored).toContain(TRASH_ONLY_MONTH);
  });
});
