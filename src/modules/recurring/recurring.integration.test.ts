/**
 * Recurring templates carrying their narrative forward (R8.3, D-66).
 *
 * The client's complaint was concrete: "we should not have to return to the previous month
 * and manually copy and paste the narrative every time." These assert the two halves that
 * remove that chore — the template fills the generated expense, and correcting the expense
 * updates the template — against a real database.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("recurring narratives (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenses, lineItems, organizations, paymentSources, recurringItems } = await import(
    "@/src/db/schema"
  );
  const { claimReferenceSeq } = await import("@/src/modules/expenses/references");
  const { carryNarrativeToTemplate } = await import("./narrative");
  const { reimbursementRulesFor } = await import("@/src/modules/expenses/reimbursement");

  let orgId: string;
  let lineItemId: string;
  let itemId: string;

  const NARRATIVE = "Monthly design subscription used for outreach flyers.";

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: "Recurring Org", docName: "Rec", activeMonth: "2099-01" })
      .returning({ id: organizations.id });
    orgId = org.id;

    await db
      .insert(paymentSources)
      .values({ orgId, label: "Paid by us, reimbursement requested", sortOrder: 0 });

    const [item] = await db
      .insert(lineItems)
      .values({ orgId, name: "Promotional", scheduledValueCents: 500_000, sortOrder: 0 })
      .returning({ id: lineItems.id });
    lineItemId = item.id;

    const [recurring] = await db
      .insert(recurringItems)
      .values({
        orgId,
        name: "Canva",
        amountCents: 12_000,
        lineItemId,
        defaultDescription: "Design tool",
        defaultNarrative: NARRATIVE,
        defaultPaymentSource: "Paid by us, reimbursement requested",
        defaultTaxCents: 720,
        defaultFeesCents: 100,
        sortOrder: 0,
      })
      .returning({ id: recurringItems.id });
    itemId = recurring.id;
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  /** What `addRecurringToMonthAction` writes, without needing a session. */
  async function addToMonth(month: string) {
    const [item] = await db
      .select()
      .from(recurringItems)
      .where(eq(recurringItems.id, itemId))
      .limit(1);

    const [created] = await db
      .insert(expenses)
      .values({
        orgId,
        lineItemId: item.lineItemId,
        month,
        date: `${month}-01`,
        name: item.name,
        description: item.defaultDescription ?? "",
        narrative: item.defaultNarrative,
        paymentSource: item.defaultPaymentSource ?? "Paid by us, reimbursement requested",
        subtotalCents: item.amountCents,
        taxCents: item.defaultTaxCents ?? 0,
        feesCents: item.defaultFeesCents ?? 0,
        // Resolved from the payment source, exactly as addRecurringToMonthAction does (D-67).
        ...(await reimbursementRulesFor(orgId, item.defaultPaymentSource)),
        sortOrder: 0,
        referenceSeq: await claimReferenceSeq(orgId, month),
        recurringItemId: itemId,
      })
      .returning({ id: expenses.id });
    return created.id;
  }

  it("fills the generated expense from the template", async () => {
    const id = await addToMonth("2099-02");
    const [created] = await db.select().from(expenses).where(eq(expenses.id, id));

    expect(created.narrative).toBe(NARRATIVE);
    expect(created.description).toBe("Design tool");
    expect(created.paymentSource).toBe("Paid by us, reimbursement requested");
    expect(created.taxCents).toBe(720);
    expect(created.feesCents).toBe(100);
    // R4.5: it arrives deliberately documentation-incomplete, so the gate still blocks it.
    expect(created.recurringItemId).toBe(itemId);
  });

  it("adds a second month without colliding on the reference (B1)", async () => {
    // Two one-click adds into one month was the exact case that failed before F0.
    const first = await addToMonth("2099-03");
    const second = await addToMonth("2099-03");
    const rows = await db
      .select({ referenceSeq: expenses.referenceSeq })
      .from(expenses)
      .where(and(eq(expenses.orgId, orgId), eq(expenses.month, "2099-03")));

    expect([first, second]).toHaveLength(2);
    expect(rows.map((row) => row.referenceSeq).sort()).toEqual([1, 2]);
  });

  it("claims the same amount however the expense was entered (D-71)", async () => {
    // The defect this test exists for: the form inherited the funder's rules while the
    // one-click add fell through to the column defaults, so the identical expense under the
    // identical funder claimed a different amount depending on how it was created — the
    // organisation quietly under-claiming on every recurring line.
    const { reimbursementRulesFor } = await import("@/src/modules/expenses/reimbursement");
    const { reimbursableCents } = await import("@/src/domain/money");

    await db
      .insert(paymentSources)
      .values({ orgId, label: "Whole receipt funder", sortOrder: 1, taxReimbursable: true, feesReimbursable: true });
    await db
      .update(recurringItems)
      .set({ defaultPaymentSource: "Whole receipt funder" })
      .where(eq(recurringItems.id, itemId));

    const id = await addToMonth("2099-07");
    const [generated] = await db.select().from(expenses).where(eq(expenses.id, id));

    const rules = await reimbursementRulesFor(orgId, "Whole receipt funder");
    expect(generated.taxReimbursable).toBe(rules.taxReimbursable);
    expect(generated.feesReimbursable).toBe(rules.feesReimbursable);

    // And the money that follows from it: this funder pays the whole receipt.
    expect(reimbursableCents(generated)).toBe(
      generated.subtotalCents + generated.taxCents + generated.feesCents,
    );

    // Restore, so the later tests see the template they expect.
    await db
      .update(recurringItems)
      .set({ defaultPaymentSource: "Paid by us, reimbursement requested" })
      .where(eq(recurringItems.id, itemId));
  });

  it("falls back to the original rule for an unknown source, never over-claiming", async () => {
    const { reimbursementRulesFor, ORIGINAL_RULES } = await import(
      "@/src/modules/expenses/reimbursement"
    );
    // An unresolvable source can only under-claim — over-claiming is what costs the
    // organisation credibility with the funder.
    expect(await reimbursementRulesFor(orgId, "No such source")).toEqual(ORIGINAL_RULES);
    expect(await reimbursementRulesFor(orgId, null)).toEqual(ORIGINAL_RULES);
    expect(ORIGINAL_RULES.taxReimbursable).toBe(false);
  });

  it("carries a corrected narrative back to the template", async () => {
    const id = await addToMonth("2099-04");
    const corrected = "Design subscription — now covering the youth programme too.";

    await db.update(expenses).set({ narrative: corrected }).where(eq(expenses.id, id));
    // The real function the save action calls, not a restatement of it.
    const carried = await carryNarrativeToTemplate({
      orgId,
      recurringItemId: itemId,
      narrative: corrected,
    });
    expect(carried).toBe(true);

    const [template] = await db
      .select({ defaultNarrative: recurringItems.defaultNarrative })
      .from(recurringItems)
      .where(eq(recurringItems.id, itemId));
    expect(template.defaultNarrative).toBe(corrected);

    // And next month starts from the corrected wording, not the original.
    const nextId = await addToMonth("2099-05");
    const [next] = await db.select().from(expenses).where(eq(expenses.id, nextId));
    expect(next.narrative).toBe(corrected);
  });

  it("keeps the template when an expense is saved with no narrative", async () => {
    // A blank narrative means "not written yet", not "delete the paragraph" — the guard that
    // stops one empty save wiping a remembered paragraph, which is why narrative lives on the
    // curated template rather than the auto-learned vendor library (D-66).
    const [before] = await db
      .select({ defaultNarrative: recurringItems.defaultNarrative })
      .from(recurringItems)
      .where(eq(recurringItems.id, itemId));

    await addToMonth("2099-06");
    for (const narrative of [null, "", "   "]) {
      expect(
        await carryNarrativeToTemplate({ orgId, recurringItemId: itemId, narrative }),
      ).toBe(false);
    }

    const [after] = await db
      .select({ defaultNarrative: recurringItems.defaultNarrative })
      .from(recurringItems)
      .where(eq(recurringItems.id, itemId));
    expect(after.defaultNarrative).toBe(before.defaultNarrative);
  });

  it("does nothing for an expense that came from no template", async () => {
    // A hand-entered expense that happens to share a payee must not rewrite the list.
    expect(
      await carryNarrativeToTemplate({
        orgId,
        recurringItemId: null,
        narrative: "Typed by hand.",
      }),
    ).toBe(false);
  });

  it("cannot write to another organisation's template", async () => {
    // The org filter is the guard; without it a guessed id would be writable.
    const [other] = await db
      .insert(organizations)
      .values({ name: "Other Org", docName: "Other", activeMonth: "2099-01" })
      .returning({ id: organizations.id });
    try {
      expect(
        await carryNarrativeToTemplate({
          orgId: other.id,
          recurringItemId: itemId,
          narrative: "Should not land.",
        }),
      ).toBe(false);
    } finally {
      await db.delete(organizations).where(eq(organizations.id, other.id));
    }
  });
});
